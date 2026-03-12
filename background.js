(function () {
  const CSS_FILE = "reader.css";
  const SCRIPT_FILE = "content-script.js";

  async function ensureInjected(tabId) {
    try {
      await browser.tabs.sendMessage(tabId, { type: "FFMC_PING" });
      return;
    } catch (error) {
      if (!error || !String(error.message || "").includes("Receiving end does not exist")) {
        throw error;
      }
    }

    await browser.tabs.insertCSS(tabId, { file: CSS_FILE, runAt: "document_idle" });
    await browser.tabs.executeScript(tabId, { file: SCRIPT_FILE, runAt: "document_idle" });
  }

  browser.browserAction.onClicked.addListener(async (tab) => {
    if (!tab || typeof tab.id !== "number") {
      return;
    }

    try {
      await ensureInjected(tab.id);
      await browser.tabs.sendMessage(tab.id, { type: "FFMC_TOGGLE" });
    } catch (error) {
      console.error("FFMC toggle failed", error);
    }
  });
})();
