import { execFile, spawn, type ChildProcess } from "node:child_process";

const powerPointId = "com.microsoft.Powerpoint";
let previewAppleScript: ChildProcess | null = null;
let presentationAppleScript: ChildProcess | null = null;

function runAppleScript(
  source: string,
  args: string[] = [],
  timeout = 30_000,
  role: "preview" | "default" = "default",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "/usr/bin/osascript",
      ["-e", source, "--", ...args],
      { timeout, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const details = `${stderr || error.message}`.trim();
          reject(new Error(details));
          return;
        }
        resolve(stdout.trim());
      },
    );
    if (role === "preview") previewAppleScript = child;
    child.once("close", () => {
      if (role === "preview" && previewAppleScript === child) previewAppleScript = null;
    });
  });
}

export function cancelPowerPointPreview(): void {
  if (!previewAppleScript || previewAppleScript.killed) return;
  previewAppleScript.kill("SIGTERM");
  previewAppleScript = null;
}

function startPowerPointAppleScript(source: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/osascript",
      ["-e", source, "--", ...args],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    presentationAppleScript = child;
    let stderr = "";
    let startupSettled = false;
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      if (!startupSettled) {
        startupSettled = true;
        reject(error);
      }
    });
    child.once("close", (code, signal) => {
      if (presentationAppleScript === child) presentationAppleScript = null;
      if (code !== 0 && code !== null) {
        if (!startupSettled) {
          startupSettled = true;
          reject(new Error(stderr.trim() || `osascript exited with code ${code}`));
        }
        return;
      }
      if (signal && signal !== "SIGTERM") {
        if (!startupSettled) {
          startupSettled = true;
          reject(new Error(stderr.trim() || `osascript stopped with ${signal}`));
        }
        return;
      }
      if (!startupSettled) {
        startupSettled = true;
        resolve();
      }
    });
    child.unref();

    // `run slide show` can remain attached to the slideshow process even
    // after PowerPoint has created its window. Give immediate AppleScript
    // failures a chance to surface, then let the caller probe PowerPoint
    // without waiting for the presentation itself to end.
    setTimeout(() => {
      if (startupSettled) return;
      startupSettled = true;
      resolve();
    }, 750);
  });
}

function automationMessage(error: unknown): Error {
  const details = String(error instanceof Error ? error.message : error);
  if (details.includes("-1743") || /not authorized|不允许|无权/i.test(details)) {
    return new Error(
      "CueDeck 需要控制 Microsoft PowerPoint。请在“系统设置 > 隐私与安全性 > 自动化”中允许 CueDeck。",
    );
  }
  if (/Application isn.t running|找不到|不能获得|Connection Invalid/i.test(details)) {
    return new Error("无法连接 Microsoft PowerPoint，请确认 PowerPoint 已安装并可正常打开。");
  }
  return new Error(`PowerPoint 操作失败：${details}`);
}

export async function renderPowerPointSlides(
  deckPath: string,
  outputDirectory: string,
): Promise<void> {
  const source = `
use framework "Foundation"
use framework "AppKit"
use framework "PDFKit"
use scripting additions

on run argv
  set deckPath to item 1 of argv
  set outputDirectory to item 2 of argv
  set pdfPath to outputDirectory & "/cue-deck-preview.pdf"
  tell application id "${powerPointId}"
    set targetPresentation to missing value
    set presentationWasOpen to false
    repeat with candidatePresentation in presentations
      try
        if (full name of candidatePresentation as text) is deckPath then
          set targetPresentation to candidatePresentation
          set presentationWasOpen to true
          exit repeat
        end if
      end try
    end repeat
    if targetPresentation is missing value then
      open (POSIX file deckPath)
      set targetPresentation to active presentation
    end if
    save targetPresentation in (POSIX file pdfPath) as save as PDF
    if presentationWasOpen is false then close targetPresentation saving no
  end tell

  set sourceURL to current application's NSURL's fileURLWithPath:pdfPath
  set pdfDocument to current application's PDFDocument's alloc()'s initWithURL:sourceURL
  if pdfDocument is missing value then error "PowerPoint PDF preview could not be opened"
  set pageCount to pdfDocument's pageCount()
  repeat with slideIndex from 1 to pageCount
    set pdfPage to pdfDocument's pageAtIndex:(slideIndex - 1)
    set pageImage to current application's NSImage's alloc()'s initWithData:(pdfPage's dataRepresentation())
    set bitmap to current application's NSBitmapImageRep's imageRepWithData:(pageImage's TIFFRepresentation())
    set pngData to bitmap's representationUsingType:(current application's NSPNGFileType) |properties|:(current application's NSDictionary's dictionary())
    set outputPath to outputDirectory & "/slide-" & slideIndex & ".png"
    set didWrite to pngData's writeToFile:outputPath atomically:true
    if (didWrite as boolean) is false then error "PowerPoint slide preview could not be written"
  end repeat
  return "ready"
end run`;

  try {
    await runAppleScript(source, [deckPath, outputDirectory], 180_000, "preview");
  } catch (error) {
    throw automationMessage(error);
  }
}

export async function startPowerPointPresentation(
  deckPath: string,
  startingSlide: number,
): Promise<void> {
  const source = `
on run argv
  set deckPath to item 1 of argv
  set startingSlide to (item 2 of argv) as integer
  tell application id "${powerPointId}"
    activate

    -- A previous failed attempt can leave a hidden show window behind.
    -- Close it before creating the new show instead of making the user
    -- recover PowerPoint manually.
    repeat while (count of slide show windows) > 0
      try
        exit slide show (slideshow view of slide show window 1)
      on error
        exit repeat
      end try
    end repeat

    set targetPresentation to missing value
    repeat with candidatePresentation in presentations
      try
        if (full name of candidatePresentation as text) is deckPath then
          set targetPresentation to candidatePresentation
          exit repeat
        end if
      end try
    end repeat
    if targetPresentation is missing value then
      open (POSIX file deckPath)
      set targetPresentation to active presentation
    end if

    set showSettings to slide show settings of targetPresentation
    set starting slide of showSettings to startingSlide
    set ending slide of showSettings to count of slides of targetPresentation
    set range type of showSettings to slide show range
    set advance mode of showSettings to slide show advance manual advance
    -- Keep the native PowerPoint show in its own window. Full-screen speaker
    -- mode can capture the whole desktop and make the private cue window
    -- impossible to reach on some PowerPoint/macOS combinations.
    set show type of showSettings to slide show type window
    set showWindow to run slide show showSettings
    if showWindow is missing value then error "PowerPoint did not return a slideshow window"
  end tell
  return "started"
end run`;

  try {
    cancelPowerPointPresentation();
    await startPowerPointAppleScript(source, [deckPath, String(Math.max(1, startingSlide))]);
    // PowerPoint may need a short interval to finish opening the deck and
    // materialize the slideshow window after the AppleScript command returns.
    await new Promise((resolve) => setTimeout(resolve, 900));
    const deadline = Date.now() + 15_000;
    let lastProbeError: unknown = null;
    while (Date.now() < deadline) {
      try {
        if (await powerPointSlideNumber() !== null) return;
      } catch (error) {
        // PowerPoint may need a moment to launch after the detached script
        // opens the file. Keep probing instead of surfacing a transient error.
        lastProbeError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (lastProbeError) throw lastProbeError;
    throw new Error(
      "PowerPoint 放映窗口未能在 15 秒内启动。请确认 PowerPoint 已打开，并允许 CueDeck 控制它后重试。",
    );
  } catch (error) {
    cancelPowerPointPresentation();
    throw automationMessage(error);
  }
}

export function cancelPowerPointPresentation(): void {
  if (!presentationAppleScript || presentationAppleScript.killed) return;
  presentationAppleScript.kill("SIGTERM");
  presentationAppleScript = null;
}

export async function powerPointSlideNumber(): Promise<number | null> {
  const source = `
tell application id "${powerPointId}"
  if (count of slide show windows) is 0 then return "closed"
  set showView to slideshow view of slide show window 1
  return (slide number of slide of showView) as text
end tell`;

  try {
    const result = await runAppleScript(source, [], 5_000);
    if (result === "closed") return null;
    const slideNumber = Number(result);
    return Number.isFinite(slideNumber) && slideNumber > 0 ? slideNumber : null;
  } catch (error) {
    throw automationMessage(error);
  }
}

export async function navigatePowerPoint(
  direction: "next" | "previous",
): Promise<void> {
  const command = direction === "next" ? "go to next slide" : "go to previous slide";
  const source = `
tell application id "${powerPointId}"
  if (count of slide show windows) is 0 then return "closed"
  set showView to slideshow view of slide show window 1
  ${command} showView
end tell
return "ok"`;

  try {
    await runAppleScript(source, [], 5_000);
  } catch (error) {
    throw automationMessage(error);
  }
}

export async function stopPowerPointPresentation(): Promise<void> {
  cancelPowerPointPresentation();
  const source = `
tell application id "${powerPointId}"
  repeat while (count of slide show windows) > 0
    exit slide show (slideshow view of slide show window 1)
  end repeat
end tell
return "stopped"`;

  try {
    await runAppleScript(source, [], 5_000);
  } catch {
    // PowerPoint may already be closed; stopping CueDeck should remain idempotent.
  }
}
