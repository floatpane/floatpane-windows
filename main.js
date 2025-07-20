const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const { set } = require("wallpaper");
const sharp = require("sharp");
const regedit = require("regedit");

let mainWindow = null;

// --- App Setup: Create Thumbnail Cache Directory ---
const cacheDir = path.join(app.getPath("userData"), "thumbnails");
if (!fsSync.existsSync(cacheDir)) {
  fsSync.mkdirSync(cacheDir, { recursive: true });
}

// --- Settings File Setup ---
const settingsPath = path.join(app.getPath("userData"), "settings.json");

async function getSettings() {
  try {
    await fs.access(settingsPath);
    const settingsFile = await fs.readFile(settingsPath, "utf-8");
    return JSON.parse(settingsFile);
  } catch (error) {
    const defaultSettings = {
      theme: "tokyo-night-blue",
      openCommand: "Control+Shift+P", // Default for Windows
    };
    await saveSettings(defaultSettings);
    return defaultSettings;
  }
}

async function saveSettings(settings) {
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

// --- Main Window Creation ---
function createWindow() {
  const currentDisplay = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  );
  const { width, height } = currentDisplay.workAreaSize;

  const windowWidth = 1920;
  const windowHeight = 1080;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round(currentDisplay.bounds.x + (width - windowWidth) / 2),
    y: Math.round(currentDisplay.bounds.y + (height - windowHeight) / 2),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    level: "floating",
    visibleOnAllWorkspaces: true,
    resizable: false,
    focusable: true,
  });

  mainWindow.loadFile(path.join(__dirname, "dist/index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// --- App Lifecycle Events ---
app.whenReady().then(async () => {
  const settings = await getSettings();
  globalShortcut.register(settings.openCommand, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    } else {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// --- IPC Handlers ---

ipcMain.handle("get-settings", getSettings);

ipcMain.handle("save-settings", async (event, settings) => {
  await saveSettings(settings);
  globalShortcut.unregisterAll();
  const newSettings = await getSettings();
  globalShortcut.register(newSettings.openCommand, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    } else {
      createWindow();
    }
  });
  if (mainWindow) {
    mainWindow.webContents.send("theme-updated", newSettings.theme);
  }
});

ipcMain.handle("get-themes", async () => {
  const themeDir = path.join(__dirname, "dist/themes");
  try {
    const files = await fs.readdir(themeDir);
    const themes = await Promise.all(
      files.map(async (file) => {
        if (file.endsWith(".json")) {
          const filePath = path.join(themeDir, file);
          const content = await fs.readFile(filePath, "utf-8");
          return JSON.parse(content);
        }
        return null;
      })
    );
    return themes.filter((theme) => theme !== null);
  } catch (error) {
    console.error(`Error reading theme directory: ${themeDir}`, error);
    return [];
  }
});

ipcMain.handle("open-external-link", (event, url) => shell.openExternal(url));

ipcMain.handle("get-wallpapers", async () => {
  const wallpaperDir = path.join(os.homedir(), "wallpapers");
  try {
    if (!fsSync.existsSync(wallpaperDir)) {
      fsSync.mkdirSync(wallpaperDir, { recursive: true });
    }
    const files = await fs.readdir(wallpaperDir);
    return files.filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file));
  } catch (error) {
    console.error(`Error reading wallpaper directory: ${wallpaperDir}`, error);
    throw new Error(`Could not read wallpapers from: ~/wallpapers.`);
  }
});

ipcMain.handle("open-wallpapers-folder", () => {
  const wallpaperDir = path.join(os.homedir(), "wallpapers");
  if (!fsSync.existsSync(wallpaperDir)) {
    fsSync.mkdirSync(wallpaperDir, { recursive: true });
  }
  shell.openPath(wallpaperDir);
});

ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("set-wallpaper", (event, imageName) => {
  const imagePath = path.join(os.homedir(), "wallpapers", imageName);
  return set(imagePath);
});

ipcMain.handle("get-current-wallpaper", async () => {
  const keyPath = "HKCU\\Control Panel\\Desktop";
  try {
    const result = await regedit.promisified.list(keyPath);
    if (
      result &&
      result[keyPath] &&
      result[keyPath].values &&
      result[keyPath].values.Wallpaper
    ) {
      return result[keyPath].values.Wallpaper.value;
    }
    return ""; // Return empty string if not found
  } catch (error) {
    console.error("Failed to get current wallpaper from registry", error);
    return ""; // Return empty string on error
  }
});

ipcMain.handle("get-thumbnail", async (event, imageName) => {
  const sourcePath = path.join(os.homedir(), "wallpapers", imageName);
  const thumbPath = path.join(cacheDir, imageName);

  try {
    await fs.access(thumbPath);
    const data = await fs.readFile(thumbPath);
    return data.toString("base64");
  } catch {
    try {
      await sharp(sourcePath).resize(400).toFile(thumbPath);
      const data = await fs.readFile(thumbPath);
      return data.toString("base64");
    } catch (generationError) {
      console.error(
        `Failed to generate thumbnail for ${imageName}:`,
        generationError
      );
      throw generationError;
    }
  }
});

ipcMain.on("hide-window", () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.on("toggle-settings", () => {
  if (mainWindow) {
    mainWindow.webContents.send("toggle-settings");
  }
});
