const { Plugin, Notice, PluginSettingTab, Setting, AbstractInputSuggest, TFolder } = require("obsidian");

// =======================================================
// 1. 国际化 (i18n) 配置 / Internationalization Config
// =======================================================
const currentLang = window.localStorage.getItem('language') || 'en';
const isChinese = currentLang.startsWith('zh');

const TEXTS = {
  zh: {
    settingTitle: "段落复制与格式化",
    regexName: "正则表达式 (每行一个)",
    regexDesc: "匹配到以下规则的段落将显示图标并缩进",
    regexPlaceholder: "^第.+条\n^Article",
    indentModeName: "缩进模式",
    indentFirst: "首行缩进",
    indentHanging: "悬挂缩进",
    indentNone: "无缩进",
    indentSaved: "设置已保存，请刷新笔记查看效果",
    indentSizeName: "缩进大小",
    indentSizePlaceholder: "2em",
    folderName: "生效文件夹 (当前列表)",
    folderDesc: "每行一个路径，留空则全局生效。你可以手动编辑，也可以使用上方的搜索框快速添加。",
    folderSearchName: "快速添加文件夹",
    folderSearchDesc: "搜索并选择文件夹，自动追加到下方列表中",
    folderSearchPlaceholder: "输入文件夹名称...",
    copyBtnText: "📋",
    copyBtnTitle: "复制本节",
    copyBtnAria: "复制本节内容",
    copySuccessIcon: "✅",
    copyFail: "复制失败",
    warnRegex: "无效的正则表达式",
    addedFolder: "已添加: ",
    duplicateFolder: "文件夹已存在"
  },
  en: {
    settingTitle: "Paragraph Copy & Formatting",
    regexName: "Regex Patterns (One per line)",
    regexDesc: "Paragraphs matching these rules will get a copy button and indentation.",
    regexPlaceholder: "^Article\n^Section",
    indentModeName: "Indentation Mode",
    indentFirst: "First Line",
    indentHanging: "Hanging",
    indentNone: "None",
    indentSaved: "Settings saved. Please reload/reopen the note to see changes.",
    indentSizeName: "Indent Size",
    indentSizePlaceholder: "2em",
    folderName: "Whitelist Folders (Current List)",
    folderDesc: "One path per line. Leave empty to apply globally. You can edit manually or use the search box above to add.",
    folderSearchName: "Quick Add Folder",
    folderSearchDesc: "Search and select a folder to append it to the list below",
    folderSearchPlaceholder: "Type folder name...",
    copyBtnText: "📋",
    copyBtnTitle: "Copy Section",
    copyBtnAria: "Copy content of this section",
    copySuccessIcon: "✅",
    copyFail: "Copy failed",
    warnRegex: "Invalid Regex Pattern",
    addedFolder: "Added: ",
    duplicateFolder: "Folder already in whitelist"
  }
};

function t(key) {
  return isChinese ? (TEXTS.zh[key] || key) : (TEXTS.en[key] || key);
}

// =======================================================
// 2. 默认设置 / Default Settings
// =======================================================
const DEFAULT_SETTINGS = {
  whitelistFolders: [],
  // 包含中文习惯(第x条) 和 英文习惯(Article/Section/Chapter)
  regexPatterns: "^(\\**)?第.+条\n^\\d+(\\.\\d+)+\\s*\n^\\d+\\.\\s*\n^\\d+、\\s*\n^Article\\s+\\d+\n^Section\\s+\\d+\n^Chapter\\s+\\d+",
  indentType: "first", 
  indentSize: "2em"
};

// =======================================================
// 3. 核心插件类 / Main Plugin Class
// =======================================================
module.exports = class ParagraphCopyPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    
    // 注册设置页面
    this.addSettingTab(new ParagraphCopySettingTab(this.app, this));
    
    // 初始化样式
    this.updateStyleVariables();

    // 注册Markdown处理器
    this.registerMarkdownPostProcessor(this.postProcessor.bind(this));
  }

  // 渲染后处理逻辑
  postProcessor(el, ctx) {
    try {
      // 1. 白名单检查
      if (this.settings.whitelistFolders && this.settings.whitelistFolders.length > 0) {
        if (!ctx.sourcePath) return;
        const matched = this.settings.whitelistFolders.some(folder =>
          ctx.sourcePath === folder || ctx.sourcePath.startsWith(folder + "/")
        );
        if (!matched) return;
      }

      // 2. 获取编译后的正则
      const patterns = this.getCompiledRegexs();
      if (patterns.length === 0) return;

      // 3. 遍历并处理段落
      const paragraphs = el.querySelectorAll("p");
      paragraphs.forEach((p, index) => {
        const text = p.innerText?.trim();
        if (!text) return;

        // 检查是否匹配正则
        const isMatch = patterns.some(regex => regex.test(text));
        if (!isMatch) return;

        // 防止重复添加按钮
        if (p.querySelector(".law-copy-btn")) return;

        // 创建复制按钮
        const btn = document.createElement("span");
        btn.textContent = t('copyBtnText');
        btn.className = "law-copy-btn";
        btn.title = t('copyBtnTitle');
        btn.setAttribute("aria-label", t('copyBtnAria'));

        // 绑定点击事件
        btn.onclick = (e) => this.handleCopy(e, paragraphs, index, patterns, btn);

        // 应用缩进样式
        p.classList.remove("lac-indent-first", "lac-indent-hanging", "lac-no-indent");
        const type = this.settings.indentType || "first";
        if (type === "first") p.classList.add("lac-indent-first");
        else if (type === "hanging") p.classList.add("lac-indent-hanging");
        else p.classList.add("lac-no-indent");

        p.prepend(btn);
      });
    } catch (e) {
      console.error("Paragraph Copy Plugin Error:", e);
    }
  }

  // 处理复制逻辑
  async handleCopy(e, paragraphs, index, patterns, btn) {
    e.preventDefault();
    e.stopPropagation();
    const lines = [];

    // 向下收集文本，直到遇到下一个匹配项
    for (let i = index; i < paragraphs.length; i++) {
      const original = paragraphs[i];
      const currentText = original.innerText.trim();

      if (i !== index) {
        const isNextMatch = patterns.some(regex => regex.test(currentText));
        if (isNextMatch) break;
      }

      // 克隆节点并清洗数据
      const clone = original.cloneNode(true);
      clone.querySelectorAll(".law-copy-btn, .snw-block-preview, .snw-link-preview").forEach(x => x.remove());
      
      let cleaned = clone.innerText.trim();
      cleaned = cleaned.replace(/\s*\^[a-zA-Z0-9_-]+$/, ""); // 去除块ID
      lines.push(cleaned);
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      const originalIcon = btn.textContent;
      btn.textContent = t('copySuccessIcon');
      setTimeout(() => { btn.textContent = originalIcon; }, 1500);
    } catch (err) {
      new Notice(t('copyFail'));
    }
  }

  getCompiledRegexs() {
    const patternsStr = this.settings.regexPatterns || "";
    const rawPatterns = patternsStr.split("\n");
    const compiled = [];
    
    for (const p of rawPatterns) {
      const patternStr = p.trim();
      if (!patternStr) continue;
      try {
        compiled.push(new RegExp(patternStr));
      } catch (e) {
        console.warn(`${t('warnRegex')}: ${patternStr}`);
      }
    }
    return compiled;
  }

  updateStyleVariables() {
    const size = this.settings.indentSize || "2em";
    document.body.style.setProperty('--lac-indent-size', size);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateStyleVariables();
  }
};

// =======================================================
// 4. 文件夹建议类 / Folder Suggest Class
// =======================================================
class FolderSuggest extends AbstractInputSuggest {
  constructor(app, inputEl, onSelectCallback) {
    super(app, inputEl);
    this.onSelectCallback = onSelectCallback;
  }

  getSuggestions(query) {
    const lowerCaseQuery = query.toLowerCase();
    const files = this.app.vault.getAllLoadedFiles();
    const folders = [];
    
    for (const file of files) {
      if (file instanceof TFolder) {
        if (file.path.toLowerCase().includes(lowerCaseQuery)) {
          folders.push(file);
        }
      }
    }
    return folders;
  }

  renderSuggestion(file, el) {
    el.setText(file.path);
  }

  selectSuggestion(file) {
    this.onSelectCallback(file.path);
    this.close();
  }
}

// =======================================================
// 5. 设置页类 / Setting Tab Class
// =======================================================
class ParagraphCopySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: t('settingTitle') });

    // --- 正则设置 ---
    new Setting(containerEl)
      .setName(t('regexName'))
      .setDesc(t('regexDesc'))
      .addTextArea(text => {
        text
          .setPlaceholder(t('regexPlaceholder'))
          .setValue(this.plugin.settings.regexPatterns)
          .onChange(async (value) => {
            this.plugin.settings.regexPatterns = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
      });

    // --- 缩进模式 ---
    new Setting(containerEl)
      .setName(t('indentModeName'))
      .addDropdown(drop => {
        drop
          .addOption("first", t('indentFirst'))
          .addOption("hanging", t('indentHanging'))
          .addOption("none", t('indentNone'))
          .setValue(this.plugin.settings.indentType)
          .onChange(async (value) => {
            this.plugin.settings.indentType = value;
            await this.plugin.saveSettings();
            new Notice(t('indentSaved'));
          });
      });

    // --- 缩进大小 ---
    new Setting(containerEl)
      .setName(t('indentSizeName'))
      .addText(text => {
        text
          .setPlaceholder(t('indentSizePlaceholder'))
          .setValue(this.plugin.settings.indentSize)
          .onChange(async (value) => {
            this.plugin.settings.indentSize = value;
            await this.plugin.saveSettings();
          });
      });

    // --- 文件夹设置区域 ---
    containerEl.createEl("h3", { text: "Folder Settings" });

    // 这里的关键：保存下方 TextArea 的引用，以便在搜索回调中直接更新它
    let folderListTextArea;

    // 1. 搜索框
    new Setting(containerEl)
      .setName(t('folderSearchName'))
      .setDesc(t('folderSearchDesc'))
      .addSearch(cb => {
        cb.setPlaceholder(t('folderSearchPlaceholder'));
        
        new FolderSuggest(this.app, cb.inputEl, async (folderPath) => {
            // 查重逻辑
            if (!this.plugin.settings.whitelistFolders.includes(folderPath)) {
                // 更新数据
                this.plugin.settings.whitelistFolders.push(folderPath);
                await this.plugin.saveSettings();
                
                // 核心修复：直接更新下方文本框的值，而不刷新整个页面
                if (folderListTextArea) {
                    folderListTextArea.setValue(this.plugin.settings.whitelistFolders.join("\n"));
                }
                
                // 清空搜索框并提示
                cb.setValue("");
                new Notice(`${t('addedFolder')}${folderPath}`);
            } else {
                new Notice(t('duplicateFolder'));
                cb.setValue("");
            }
        });
      });

    // 2. 文件夹列表框
    new Setting(containerEl)
        .setName(t('folderName'))
        .setDesc(t('folderDesc'))
        .addTextArea(text => {
            // 赋值给变量
            folderListTextArea = text;
            
            text.setValue(this.plugin.settings.whitelistFolders.join("\n"))
                .onChange(async (value) => {
                    this.plugin.settings.whitelistFolders = value.split("\n").map(v=>v.trim()).filter(v=>v.length>0);
                    await this.plugin.saveSettings();
                });
            text.inputEl.rows = 6;
            text.inputEl.cols = 50;
        })
  }
}