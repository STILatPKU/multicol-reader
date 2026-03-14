(function () {
  if (window.__FFMC_LOADED__) {
    return;
  }
  window.__FFMC_LOADED__ = true;

  const MODE = {
    IDLE: "IDLE",
    SELECTING: "SELECTING",
    READING: "READING",
  };

  const CLASSNAMES = {
    overlayRoot: "ffmc-overlay-root",
    highlightBox: "ffmc-highlight-box",
    label: "ffmc-label",
    hint: "ffmc-hint",
    measureRoot: "ffmc-measure-root",
    measureFrame: "ffmc-measure-frame",
    readingStage: "ffmc-reading-stage",
    readingHeader: "ffmc-reading-header",
    readingMeta: "ffmc-reading-meta",
    readingViewports: "ffmc-reading-viewports",
    readingColumn: "ffmc-reading-column",
    readingSource: "ffmc-reading-source",
    readingRootClone: "ffmc-reading-root-clone",
    tableScrollWrapper: "ffmc-table-scroll-wrapper",
    hidden: "ffmc-hidden-by-extension",
  };

  const MIN_RECT_WIDTH = 240;
  const MIN_RECT_HEIGHT = 160;
  const MIN_TEXT_LENGTH = 80;
  const MIN_SAFE_WIDTH = 480;
  const MIN_SAFE_HEIGHT = 240;
  const STAGE_MARGIN = 8;
  const STAGE_PADDING = 24;
  const STAGE_BORDER_WIDTH = 1;
  const HEADER_HEIGHT = 22;
  const HEADER_MARGIN_TOP = -16;
  const HEADER_MARGIN_BOTTOM = 6;
  const HEADER_FLOW_HEIGHT = HEADER_HEIGHT + HEADER_MARGIN_TOP + HEADER_MARGIN_BOTTOM;
  const COLUMN_GAP = 24;
  const EXACT_LAYOUT_CLASSNAMES = new Set([
    "page-columns",
    "page-full",
    "column-body",
    "column-margin",
    "column-container",
    "margin-sidebar",
    "no-row-height",
    "quarto-title-banner",
    "quarto-banner-title-block",
    "wp-block-columns",
    "wp-block-column",
    "alignwide",
    "alignfull",
    "container",
    "container-fluid",
    "prose",
    "content-grid",
    "content-wrap",
    "docs-content",
    "doc-content",
  ]);
  const LAYOUT_CLASS_PATTERNS = [
    /^quarto-/,
    /^page-/,
    /^column-/,
    /^wp-block-/,
    /^docs?-/,
    /^content-/,
    /^layout-/,
    /^grid-/,
    /^mx-auto$/,
    /^max-w-/,
  ];
  const NEGATIVE_NAME_RE = /(nav|sidebar|menu|toolbar|ad|popup|modal|cookie|chat|comment|share|social|banner)/i;
  const FLOATER_NAME_RE = /(chat|float|back-?to-?top|cookie|popup|ad|toast|bubble|widget|assistant)/i;
  const TEXT_TAGS = new Set(["ARTICLE", "MAIN", "SECTION", "DIV"]);
  const SKIP_TAGS = new Set(["HTML", "BODY", "SCRIPT", "STYLE", "NOSCRIPT"]);

  const state = {
    mode: MODE.IDLE,
    overlayRoot: null,
    highlightBox: null,
    label: null,
    hintBar: null,
    measureRoot: null,
    readingStage: null,
    readingMeta: null,
    readingColumns: [],
    currentCandidate: null,
    selectedRoot: null,
    columnCount: 2,
    hiddenElements: [],
    listeners: [],
    observers: {
      resize: null,
      mutation: null,
    },
    rafId: null,
    relayoutRafId: null,
    renderRafId: null,
    lastPointer: { x: 0, y: 0 },
    layout: null,
    scrollProgress: 0,
    targetScrollProgress: 0,
    maxScrollProgress: 0,
    contentHeight: 0,
    imageLoadHandler: null,
    lastMetaUpdateTime: 0,
    pendingRelayoutTimeout: null,
  };

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") {
      return undefined;
    }

    if (message.type === "FFMC_PING") {
      return Promise.resolve({ ok: true });
    }

    if (message.type === "FFMC_TOGGLE") {
      if (state.mode === MODE.IDLE) {
        enterSelectingMode();
      } else {
        teardownAll();
      }
    }

    return undefined;
  });

  function enterSelectingMode() {
    teardownAll();
    state.mode = MODE.SELECTING;
    createOverlay();
    setSelectionUIVisible(true);
    hideObviousFloaters("selection");
    bindSelectingListeners();
    updateHint("Move to highlight an article container, click to select. In reader mode: wheel or arrow keys to scroll, 1/2/3 to change columns, Esc to exit.");
  }

  function enterReadingMode() {
    const selectionCheck = explainSelectionValidity(state.selectedRoot);
    if (!selectionCheck.ok) {
      enterSelectingMode();
      updateHint(`This selection is not suitable for reading: ${selectionCheck.reason}`);
      console.info("FFMC reading entry rejected", selectionCheck);
      return;
    }

    stopSelectingInteraction();
    state.mode = MODE.READING;
    createOverlay();
    setSelectionUIVisible(false);
    hideObviousFloaters("reading");
    bindReadingListeners();
    setupObservers();
    state.scrollProgress = 0;
    state.targetScrollProgress = 0;
    applyReadingLayout();
  }

  function createOverlay() {
    destroyOverlay();

    const root = document.createElement("div");
    root.className = CLASSNAMES.overlayRoot;

    const highlight = document.createElement("div");
    highlight.className = CLASSNAMES.highlightBox;

    const label = document.createElement("div");
    label.className = CLASSNAMES.label;

    const hint = document.createElement("div");
    hint.className = CLASSNAMES.hint;

    const measureRoot = document.createElement("div");
    measureRoot.className = CLASSNAMES.measureRoot;

    root.appendChild(highlight);
    root.appendChild(label);
    root.appendChild(hint);
    root.appendChild(measureRoot);

    const parent = document.body || document.documentElement;
    parent.appendChild(root);

    state.overlayRoot = root;
    state.highlightBox = highlight;
    state.label = label;
    state.hintBar = hint;
    state.measureRoot = measureRoot;
  }

  function destroyOverlay() {
    if (state.overlayRoot && state.overlayRoot.parentNode) {
      state.overlayRoot.parentNode.removeChild(state.overlayRoot);
    }

    state.overlayRoot = null;
    state.highlightBox = null;
    state.label = null;
    state.hintBar = null;
    state.measureRoot = null;
    state.readingStage = null;
    state.readingMeta = null;
    state.readingColumns = [];
  }

  function bindSelectingListeners() {
    addListener(window, "pointermove", onPointerMove, true);
    addListener(window, "click", onSelectingClick, true);
    addListener(window, "keydown", onSelectingKeydown, true);
  }

  function bindReadingListeners() {
    addListener(window, "keydown", onReadingKeydown, true);
    addListener(window, "resize", scheduleRelayout, true);
  }

  function addListener(target, type, handler, options) {
    const normalizedOptions = normalizeListenerOptions(options);
    target.addEventListener(type, handler, normalizedOptions);
    state.listeners.push({ target, type, handler, options: normalizedOptions });
  }

  function removeAllListeners() {
    for (const entry of state.listeners) {
      entry.target.removeEventListener(entry.type, entry.handler, entry.options);
    }
    state.listeners = [];
  }

  function removeListener(target, type, handler, options) {
    const normalizedOptions = normalizeListenerOptions(options);
    target.removeEventListener(type, handler, normalizedOptions);
    state.listeners = state.listeners.filter((entry) => {
      return !(
        entry.target === target &&
        entry.type === type &&
        entry.handler === handler &&
        sameListenerOptions(entry.options, normalizedOptions)
      );
    });
  }

  function removeListenersForTarget(target) {
    state.listeners = state.listeners.filter((entry) => {
      if (entry.target !== target) {
        return true;
      }

      entry.target.removeEventListener(entry.type, entry.handler, entry.options);
      return false;
    });
  }

  function normalizeListenerOptions(options) {
    if (typeof options === "boolean" || options === undefined) {
      return { capture: Boolean(options) };
    }

    return {
      capture: Boolean(options.capture),
      passive: Boolean(options.passive),
    };
  }

  function sameListenerOptions(a, b) {
    return Boolean(a && a.capture) === Boolean(b && b.capture) &&
      Boolean(a && a.passive) === Boolean(b && b.passive);
  }

  function onPointerMove(event) {
    state.lastPointer = { x: event.clientX, y: event.clientY };
    if (state.rafId) {
      return;
    }

    state.rafId = window.requestAnimationFrame(() => {
      state.rafId = null;
      const element = document.elementFromPoint(state.lastPointer.x, state.lastPointer.y);
      state.currentCandidate = findCandidateContainer(element);
      renderHighlight(state.currentCandidate);
    });
  }

  function onSelectingClick(event) {
    if (state.mode !== MODE.SELECTING) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const selectionCheck = explainSelectionValidity(state.currentCandidate);
    if (!selectionCheck.ok) {
      updateHint(`This selection is not suitable for reading: ${selectionCheck.reason}`);
      console.info("FFMC selection rejected", selectionCheck);
      return;
    }

    state.selectedRoot = state.currentCandidate;
    enterReadingMode();
  }

  function onSelectingKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    teardownAll();
  }

  function onReadingKeydown(event) {
    if (state.mode !== MODE.READING) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      teardownAll();
      return;
    }

    if (event.key === "1" || event.key === "2" || event.key === "3") {
      event.preventDefault();
      event.stopPropagation();
      state.columnCount = Number(event.key);
      state.scrollProgress = 0;
      state.targetScrollProgress = 0;
      applyReadingLayout();
      return;
    }

    const columnHeight = state.layout ? state.layout.columnHeight : 480;
    const step = Math.max(80, Math.round(columnHeight * 0.12));
    const pageStep = Math.max(columnHeight, Math.round(columnHeight * state.columnCount));
    if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      updateScrollProgress(step);
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      event.stopPropagation();
      updateScrollProgress(-step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      setScrollProgress(state.targetScrollProgress + pageStep);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      setScrollProgress(state.targetScrollProgress - pageStep);
    } else if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      setScrollProgress(0);
    } else if (event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      setScrollProgress(state.maxScrollProgress);
    }
  }

  function onReadingWheel(event) {
    if (state.mode !== MODE.READING) {
      return;
    }

    // If the cursor is inside a horizontally overflowing element (e.g. a wide
    // table or a <pre> block), apply the horizontal component to that element
    // and the vertical component to the global reader scroll simultaneously.
    const hTarget = findHScrollTarget(event.target);
    if (hTarget) {
      const hDelta = event.deltaX;
      const vDelta = event.deltaY;

      if (hDelta !== 0) {
        event.preventDefault();
        applyHScroll(hTarget, hDelta);
      }

      if (vDelta !== 0) {
        event.preventDefault();
        queueScrollDelta(vDelta);
      }

      return;
    }

    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!delta) {
      return;
    }

    event.preventDefault();
    queueScrollDelta(delta);
  }

  function onReadingClick() {
    if (state.readingStage && document.activeElement !== state.readingStage) {
      state.readingStage.focus({ preventScroll: true });
    }
  }

  function onReadingMouseEnter() {
    if (state.readingStage && document.activeElement !== state.readingStage) {
      state.readingStage.focus({ preventScroll: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Horizontal-scroll helpers for overflowing elements (tables, pre blocks, …)
  // ---------------------------------------------------------------------------

  /**
   * Walk up from `target` to the reading stage and return the first element
   * that is a real horizontal scroll container (overflow-x: auto|scroll and
   * scrollWidth > clientWidth).
   */
  function findHScrollTarget(target) {
    if (!state.readingStage) {
      return null;
    }
    let element = target;
    while (element && element !== state.readingStage) {
      if (element.scrollWidth > element.clientWidth + 2) {
        const ox = window.getComputedStyle(element).overflowX;
        if (ox === "auto" || ox === "scroll") {
          return element;
        }
      }
      element = element.parentElement;
    }
    return null;
  }

  /**
   * Scroll `element` horizontally by `delta` pixels and sync the new
   * scrollLeft to the matching element in every other column.
   */
  function applyHScroll(element, delta) {
    const maxScroll = element.scrollWidth - element.clientWidth;
    element.scrollLeft = clamp(element.scrollLeft + delta, 0, maxScroll);
    syncHScrollAcrossColumns(element);
  }

  /**
   * Given a horizontally-scrolled element in one column's clone, apply the
   * same scrollLeft to the equivalent element in all other columns.
   */
  function syncHScrollAcrossColumns(element) {
    let sourceIndex = -1;
    let path = null;

    for (let i = 0; i < state.readingColumns.length; i++) {
      const { wrapper } = state.readingColumns[i];
      if (wrapper && wrapper.contains(element)) {
        path = getElementDomPath(element, wrapper);
        sourceIndex = i;
        break;
      }
    }

    if (sourceIndex === -1 || !path) {
      return;
    }

    const targetScrollLeft = element.scrollLeft;
    for (let i = 0; i < state.readingColumns.length; i++) {
      if (i === sourceIndex) {
        continue;
      }
      const { wrapper } = state.readingColumns[i];
      if (!wrapper) {
        continue;
      }
      const peer = getElementByDomPath(path, wrapper);
      if (peer) {
        peer.scrollLeft = targetScrollLeft;
      }
    }
  }

  /**
   * Return an array of child-index steps from `root` down to `element`, or
   * null if `element` is not a descendant of `root`.
   */
  function getElementDomPath(element, root) {
    const path = [];
    let current = element;
    while (current && current !== root) {
      const parent = current.parentElement;
      if (!parent) {
        return null;
      }
      path.unshift(Array.from(parent.children).indexOf(current));
      current = parent;
    }
    return current === root ? path : null;
  }

  /**
   * Walk `path` from `root` returning the descendant element, or null if the
   * path is invalid.
   */
  function getElementByDomPath(path, root) {
    let current = root;
    for (const index of path) {
      if (!current || index >= current.children.length) {
        return null;
      }
      current = current.children[index];
    }
    return current;
  }

  function stopSelectingInteraction() {
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }

    removeListener(window, "pointermove", onPointerMove, true);
    removeListener(window, "click", onSelectingClick, true);
    removeListener(window, "keydown", onSelectingKeydown, true);
  }

  function applyReadingLayout() {
    if (!state.selectedRoot || !state.selectedRoot.isConnected) {
      teardownAll();
      return;
    }

    const safeRect = getEffectiveSafeRect(computeSafeRect(state.selectedRoot));
    const layout = computeLayoutParams(safeRect, state.columnCount);
    const measuredHeight = measureContentHeight(layout.columnWidth);

    state.layout = layout;
    state.contentHeight = measuredHeight;
    state.maxScrollProgress = Math.max(0, measuredHeight - layout.columnHeight * state.columnCount);
    state.scrollProgress = clamp(state.scrollProgress, 0, state.maxScrollProgress);
    state.targetScrollProgress = clamp(state.targetScrollProgress, 0, state.maxScrollProgress);

    renderReadingStage(layout);
    attachReadingStageEvents();
    renderReadingColumns();
    updateReadingMeta();
    setSelectionUIVisible(false);
    updateHint("");
    ensureReadingFocus();
  }

  function renderReadingStage(layout) {
    if (!state.overlayRoot) {
      return;
    }

    if (state.readingStage && state.readingStage.parentNode) {
      removeListenersForTarget(state.readingStage);
      state.readingStage.parentNode.removeChild(state.readingStage);
    }

    const stage = document.createElement("div");
    stage.className = CLASSNAMES.readingStage;
    stage.style.left = `${layout.stageLeft}px`;
    stage.style.top = `${layout.stageTop}px`;
    stage.style.width = `${layout.stageWidth}px`;
    stage.style.height = `${layout.stageHeight}px`;
    stage.style.outline = "none";
    stage.setAttribute("tabindex", "-1");

    const header = document.createElement("div");
    header.className = CLASSNAMES.readingHeader;

    const meta = document.createElement("div");
    meta.className = CLASSNAMES.readingMeta;
    header.appendChild(meta);

    const viewports = document.createElement("div");
    viewports.className = CLASSNAMES.readingViewports;
    viewports.style.setProperty("--ffmc-columns", String(state.columnCount));
    viewports.style.setProperty("--ffmc-gap", `${layout.columnGap}px`);

    state.readingColumns = [];
    for (let index = 0; index < state.columnCount; index += 1) {
      const column = document.createElement("section");
      column.className = CLASSNAMES.readingColumn;
      column.style.height = `${layout.columnHeight}px`;

      const source = document.createElement("div");
      source.className = CLASSNAMES.readingSource;
      source.style.width = "100%";
      source.style.maxWidth = "100%";

      const contextual = createContextualClone();
      if (contextual) {
        source.appendChild(contextual.container);
      }

      column.appendChild(source);
      viewports.appendChild(column);
      state.readingColumns.push({
        column,
        source,
        wrapper: contextual ? contextual.wrapper : null,
      });
    }

    stage.appendChild(header);
    stage.appendChild(viewports);
    state.overlayRoot.appendChild(stage);

    state.readingStage = stage;
    state.readingMeta = meta;
  }

  function attachReadingStageEvents() {
    if (!state.readingStage) {
      return;
    }

    addListener(state.readingStage, "wheel", onReadingWheel, { passive: false });
    addListener(state.readingStage, "click", onReadingClick, false);
    addListener(state.readingStage, "mouseenter", onReadingMouseEnter, false);

    const images = state.readingStage.querySelectorAll("img");
    if (images.length === 0) {
      return;
    }

    state.imageLoadHandler = scheduleRelayout;
    for (const image of images) {
      if (!image.complete) {
        image.addEventListener("load", state.imageLoadHandler, { once: true });
      }
    }
  }

  function renderReadingColumns() {
    if (!state.layout) {
      return;
    }

    for (let index = 0; index < state.readingColumns.length; index += 1) {
      const offset = state.scrollProgress + index * state.layout.columnHeight;
      renderColumnAtOffset(state.readingColumns[index], offset);
    }
  }

  function renderColumnAtOffset(columnState, offset) {
    if (!columnState || !columnState.wrapper) {
      return;
    }

    columnState.wrapper.style.transform = `translate3d(0, ${-offset}px, 0)`;
  }

  function createContextualClone() {
    if (!state.selectedRoot) {
      return null;
    }

    const wrapper = state.selectedRoot.cloneNode(true);
    wrapper.classList.add(CLASSNAMES.readingRootClone);
    normalizeCloneRoot(wrapper);

    return {
      container: wrapper,
      wrapper,
    };
  }

  function normalizeCloneRoot(wrapper) {
    wrapper.style.position = "relative";
    wrapper.style.left = "0";
    wrapper.style.right = "auto";
    wrapper.style.top = "0";
    wrapper.style.display = "block";
    wrapper.style.width = "100%";
    wrapper.style.maxWidth = "100%";
    wrapper.style.minWidth = "0";
    wrapper.style.minHeight = "0";
    wrapper.style.height = "auto";
    wrapper.style.gridTemplateColumns = "none";
    wrapper.style.gridTemplateRows = "none";
    wrapper.style.gridAutoFlow = "row";
    wrapper.style.columnCount = "auto";
    wrapper.style.columnWidth = "auto";
    wrapper.style.marginLeft = "0";
    wrapper.style.marginRight = "0";
    wrapper.style.paddingLeft = "0";
    wrapper.style.paddingRight = "0";
    wrapper.style.boxSizing = "border-box";
    wrapper.style.float = "none";
    wrapper.style.clear = "both";
    wrapper.style.overflow = "visible";
    wrapper.style.transformOrigin = "top left";
    normalizeCloneTree(wrapper);
  }

  function normalizeCloneTree(root) {
    const elements = [root, ...root.querySelectorAll("*")];
    for (const element of elements) {
      if (!(element instanceof Element)) {
        continue;
      }

      const hasLayoutClass = isFrameworkLayoutElement(element);
      const isMarginElement =
        element.classList.contains("column-margin") ||
        element.classList.contains("column-container") ||
        element.classList.contains("wp-block-column");

      stripProblematicLayoutClasses(element);

      if (hasLayoutClass) {
        element.style.display = "block";
        element.style.position = "relative";
        element.style.left = "0";
        element.style.right = "auto";
        element.style.top = "0";
        element.style.width = "100%";
        element.style.maxWidth = "100%";
        element.style.minWidth = "0";
        element.style.marginLeft = "0";
        element.style.marginRight = "0";
        element.style.paddingLeft = "0";
        element.style.paddingRight = "0";
        element.style.gridTemplateColumns = "none";
        element.style.gridTemplateRows = "none";
        element.style.gridAutoFlow = "row";
        element.style.columnCount = "auto";
        element.style.columnWidth = "auto";
        element.style.float = "none";
        element.style.clear = "both";
      }

      if (isMarginElement) {
        element.style.display = "block";
        element.style.width = "100%";
        element.style.maxWidth = "100%";
        element.style.margin = "1rem 0";
        element.style.padding = "0";
      }
    }

    // Wrap table elements in a scrollable container so wide tables can scroll
    // horizontally inside the column without breaking the column layout.
    for (const table of Array.from(root.querySelectorAll("table"))) {
      if (
        table.parentElement &&
        table.parentElement.classList.contains(CLASSNAMES.tableScrollWrapper)
      ) {
        continue; // already wrapped
      }
      const scrollWrap = document.createElement("div");
      scrollWrap.className = CLASSNAMES.tableScrollWrapper;
      if (table.parentElement) {
        table.parentElement.insertBefore(scrollWrap, table);
      }
      scrollWrap.appendChild(table);
      // Override the global max-width: 100% !important rule so the table can
      // be its natural content width (the wrapper constrains and scrolls it).
      table.style.setProperty("max-width", "none", "important");
    }
  }

  function stripProblematicLayoutClasses(element) {
    for (const className of Array.from(element.classList)) {
      if (isFrameworkLayoutClass(className)) {
        element.classList.remove(className);
      }
    }
  }

  function isFrameworkLayoutElement(element) {
    return Array.from(element.classList).some((className) => isFrameworkLayoutClass(className));
  }

  function isFrameworkLayoutClass(className) {
    if (EXACT_LAYOUT_CLASSNAMES.has(className)) {
      return true;
    }

    return LAYOUT_CLASS_PATTERNS.some((pattern) => pattern.test(className));
  }

  function measureContentHeight(columnWidth) {
    if (!state.measureRoot) {
      return 0;
    }

    state.measureRoot.textContent = "";

    const frame = document.createElement("div");
    frame.className = CLASSNAMES.measureFrame;
    frame.style.width = `${columnWidth}px`;

    const contextual = createContextualClone();
    if (!contextual) {
      return 0;
    }

    frame.appendChild(contextual.container);
    state.measureRoot.appendChild(frame);

    contextual.wrapper.style.minHeight = "0";
    contextual.wrapper.style.height = "auto";
    const rect = contextual.wrapper.getBoundingClientRect();
    const height = Math.max(1, Math.ceil(rect.height));

    state.measureRoot.textContent = "";
    return height;
  }

  function updateReadingMeta() {
    if (!state.readingMeta || !state.layout) {
      return;
    }

    const pagination = computePagination();
    const progress = state.maxScrollProgress === 0
      ? 100
      : Math.round((state.scrollProgress / state.maxScrollProgress) * 100);
    state.readingMeta.textContent = `${state.columnCount} cols · ${pagination.currentPage}/${pagination.totalPages} page · ${progress}% · wheel/Up/Down · Left/Right page · 1/2/3 · Esc`;
  }

  function computePagination() {
    if (!state.layout) {
      return { currentPage: 1, totalPages: 1 };
    }

    const pageSpan = state.layout.columnHeight * state.columnCount;
    const totalPages = state.contentHeight < pageSpan * 2
      ? 1
      : Math.floor(state.contentHeight / pageSpan);
    const currentPage = Math.floor(state.scrollProgress / pageSpan) + 1;

    return { currentPage, totalPages };
  }

  function updateScrollProgress(delta) {
    setScrollProgress(state.targetScrollProgress + delta);
  }

  function queueScrollDelta(delta) {
    setScrollProgress(state.targetScrollProgress + delta);
  }

  function setScrollProgress(nextValue) {
    const clamped = clamp(nextValue, 0, state.maxScrollProgress);
    if (clamped === state.targetScrollProgress && clamped === state.scrollProgress) {
      return;
    }

    state.targetScrollProgress = clamped;
    scheduleRender();
  }

  function scheduleRender() {
    if (state.renderRafId) {
      return;
    }

    state.renderRafId = window.requestAnimationFrame(() => {
      state.renderRafId = null;
      state.scrollProgress = state.targetScrollProgress;
      renderReadingColumns();
      if (performance.now() - state.lastMetaUpdateTime >= 80) {
        state.lastMetaUpdateTime = performance.now();
        updateReadingMeta();
      }
    });
  }

  function ensureReadingFocus() {
    if (state.readingStage && document.activeElement !== state.readingStage) {
      state.readingStage.focus({ preventScroll: true });
    }
  }

  function findCandidateContainer(startElement) {
    if (!startElement || startElement.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    let fallback = null;
    let element = startElement;

    while (element && element !== document.body) {
      if (isOverlayElement(element) || SKIP_TAGS.has(element.tagName)) {
        element = element.parentElement;
        continue;
      }

      if (isPotentialContainer(element)) {
        if (!fallback) {
          fallback = element;
        }
        if (isStrongCandidate(element)) {
          return element;
        }
      }

      element = element.parentElement;
    }

    return fallback;
  }

  function isPotentialContainer(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < MIN_RECT_WIDTH || rect.height < MIN_RECT_HEIGHT) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.display === "inline") {
      return false;
    }

    if (style.position === "fixed" && rect.width < window.innerWidth * 0.6 && rect.height < window.innerHeight * 0.6) {
      return false;
    }

    return true;
  }

  function isStrongCandidate(element) {
    const rect = element.getBoundingClientRect();
    const textLength = getElementTextLength(element);
    const negative = hasNegativeSignals(element);
    const tagBoost = TEXT_TAGS.has(element.tagName);

    return (
      rect.width >= MIN_RECT_WIDTH &&
      rect.height >= MIN_RECT_HEIGHT &&
      textLength >= MIN_TEXT_LENGTH &&
      !negative &&
      (tagBoost || rect.height >= window.innerHeight * 0.25)
    );
  }

  function hasNegativeSignals(element) {
    if (element.tagName === "MAIN" || element.tagName === "ARTICLE") {
      return false;
    }

    const name = `${element.tagName} ${element.id || ""} ${element.className || ""}`;
    return NEGATIVE_NAME_RE.test(name) || ["NAV", "HEADER", "FOOTER", "ASIDE", "BUTTON"].includes(element.tagName);
  }

  function getElementTextLength(element) {
    const text = (element.innerText || element.textContent || "").trim();
    return text.replace(/\s+/g, " ").length;
  }

  function explainSelectionValidity(element) {
    if (!element) {
      return { ok: false, reason: "no selectable container under pointer", element: null };
    }

    const rect = element.getBoundingClientRect();
    const textLength = getElementTextLength(element);
    const negative = hasNegativeSignals(element);
    const tagBoost = TEXT_TAGS.has(element.tagName);
    const reasons = [];

    if (rect.width < MIN_RECT_WIDTH) {
      reasons.push(`width too small (${Math.round(rect.width)} < ${MIN_RECT_WIDTH})`);
    }
    if (rect.height < MIN_RECT_HEIGHT) {
      reasons.push(`height too small (${Math.round(rect.height)} < ${MIN_RECT_HEIGHT})`);
    }
    if (textLength < MIN_TEXT_LENGTH) {
      reasons.push(`text too short (${textLength} < ${MIN_TEXT_LENGTH})`);
    }
    if (negative) {
      reasons.push("matched negative class/id/tag signal");
    }
    if (!tagBoost && rect.height < window.innerHeight * 0.25) {
      reasons.push("not a strong content tag and not tall enough");
    }

    return {
      ok: reasons.length === 0,
      reason: reasons.length === 0 ? "ok" : reasons.join(", "),
      element: describeElement(element),
    };
  }

  function getEffectiveSafeRect(safeRect) {
    const width = Math.max(MIN_SAFE_WIDTH, window.innerWidth - STAGE_MARGIN * 2);
    const height = Math.max(MIN_SAFE_HEIGHT, window.innerHeight - STAGE_MARGIN * 2);

    return {
      left: STAGE_MARGIN,
      top: STAGE_MARGIN,
      width,
      height,
    };
  }

  function computeSafeRect(root) {
    const rootRect = root.getBoundingClientRect();
    const obstacles = collectObstacleRects(root, rootRect);

    let safeTop = rootRect.top;
    let safeLeft = rootRect.left;
    let safeRight = rootRect.right;
    let safeBottom = rootRect.bottom;

    for (const rect of obstacles) {
      const horizontalCoverage = overlapSize(rootRect.left, rootRect.right, rect.left, rect.right) / Math.max(rootRect.width, 1);
      const verticalCoverage = overlapSize(rootRect.top, rootRect.bottom, rect.top, rect.bottom) / Math.max(rootRect.height, 1);

      if (rect.top <= rootRect.top + 80 && horizontalCoverage >= 0.5) {
        safeTop = Math.max(safeTop, rect.bottom);
      }
      if (rect.left <= rootRect.left + 80 && verticalCoverage >= 0.5) {
        safeLeft = Math.max(safeLeft, rect.right);
      }
      if (rect.right >= rootRect.right - 80 && verticalCoverage >= 0.5) {
        safeRight = Math.min(safeRight, rect.left);
      }
      if (rect.bottom >= rootRect.bottom - 80 && horizontalCoverage >= 0.5) {
        safeBottom = Math.min(safeBottom, rect.top);
      }
    }

    return {
      width: Math.max(0, safeRight - safeLeft),
      height: Math.max(0, safeBottom - safeTop),
    };
  }

  function collectObstacleRects(root, rootRect) {
    const obstacles = [];
    const allElements = document.body ? document.body.getElementsByTagName("*") : [];

    for (const element of allElements) {
      if (
        element === root ||
        root.contains(element) ||
        isOverlayElement(element) ||
        element.classList.contains(CLASSNAMES.hidden)
      ) {
        continue;
      }

      const style = window.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") {
        continue;
      }
      if (style.position !== "fixed" && style.position !== "sticky") {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40 || !rectsOverlap(rootRect, rect)) {
        continue;
      }

      const zIndex = Number.parseInt(style.zIndex, 10);
      const edgePinned = rect.top <= 24 || rect.left <= 24 || rect.right >= window.innerWidth - 24 || rect.bottom >= window.innerHeight - 24;
      if (!edgePinned && !(Number.isFinite(zIndex) && zIndex >= 10)) {
        continue;
      }

      obstacles.push(rect);
    }

    return obstacles;
  }

  function computeLayoutParams(safeRect, columnCount) {
    const stageWidth = safeRect.width;
    const stageHeight = safeRect.height;
    const contentWidth = stageWidth - (STAGE_BORDER_WIDTH + STAGE_PADDING) * 2;
    const contentHeight = stageHeight - (STAGE_BORDER_WIDTH + STAGE_PADDING) * 2 - HEADER_FLOW_HEIGHT;
    const columnWidth = Math.max(180, Math.floor((contentWidth - COLUMN_GAP * (columnCount - 1)) / columnCount));

    return {
      stageLeft: safeRect.left,
      stageTop: safeRect.top,
      stageWidth,
      stageHeight,
      columnWidth,
      columnHeight: Math.max(200, contentHeight),
      columnGap: COLUMN_GAP,
    };
  }

  function hideObviousFloaters(mode) {
    restoreHiddenElements();

    const allElements = document.body ? document.body.getElementsByTagName("*") : [];
    for (const element of allElements) {
      if (!(element instanceof Element) || isOverlayElement(element)) {
        continue;
      }

      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.position !== "fixed") {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const name = `${element.id || ""} ${element.className || ""}`;
      const smallFloater = rect.width <= window.innerWidth * 0.35 && rect.height <= window.innerHeight * 0.35;
      const cornerPinned =
        rect.right >= window.innerWidth - 80 ||
        rect.bottom >= window.innerHeight - 80 ||
        rect.left <= 80 ||
        rect.top <= 80;

      if (!smallFloater) {
        continue;
      }
      if (!cornerPinned && !FLOATER_NAME_RE.test(name)) {
        continue;
      }
      if (mode === "selection" && rect.width > window.innerWidth * 0.5 && rect.height > 80) {
        continue;
      }

      element.classList.add(CLASSNAMES.hidden);
      state.hiddenElements.push(element);
    }
  }

  function restoreHiddenElements() {
    for (const element of state.hiddenElements) {
      if (element && element.isConnected) {
        element.classList.remove(CLASSNAMES.hidden);
      }
    }
    state.hiddenElements = [];
  }

  function setupObservers() {
    cleanupObservers();

    if (typeof ResizeObserver === "function" && state.selectedRoot) {
      state.observers.resize = new ResizeObserver(() => {
        scheduleRelayout();
      });
      state.observers.resize.observe(state.selectedRoot);
    }

    state.observers.mutation = new MutationObserver(() => {
      if (!state.selectedRoot || !state.selectedRoot.isConnected) {
        teardownAll();
        return;
      }
      hideObviousFloaters("reading");
      scheduleRelayout();
    });

    state.observers.mutation.observe(state.selectedRoot, {
      childList: true,
      subtree: true,
    });
  }

  function cleanupObservers() {
    if (state.observers.resize) {
      state.observers.resize.disconnect();
      state.observers.resize = null;
    }
    if (state.observers.mutation) {
      state.observers.mutation.disconnect();
      state.observers.mutation = null;
    }
  }

  function scheduleRelayout() {
    if (state.mode !== MODE.READING) {
      return;
    }

    if (state.relayoutRafId || state.pendingRelayoutTimeout) {
      return;
    }

    state.pendingRelayoutTimeout = window.setTimeout(() => {
      state.pendingRelayoutTimeout = null;
      state.relayoutRafId = window.requestAnimationFrame(() => {
        state.relayoutRafId = null;
        applyReadingLayout();
      });
    }, 120);
  }

  function setSelectionUIVisible(visible) {
    if (!state.highlightBox || !state.label || !state.hintBar) {
      return;
    }

    const opacity = visible ? "1" : "0";
    state.highlightBox.style.opacity = opacity;
    state.label.style.opacity = opacity;
    state.hintBar.style.opacity = visible ? "1" : "0";
  }

  function renderHighlight(element) {
    if (!state.highlightBox || !state.label) {
      return;
    }

    if (!element) {
      state.highlightBox.style.opacity = "0";
      state.label.style.opacity = "0";
      return;
    }

    const rect = element.getBoundingClientRect();
    state.highlightBox.style.left = `${rect.left}px`;
    state.highlightBox.style.top = `${rect.top}px`;
    state.highlightBox.style.width = `${rect.width}px`;
    state.highlightBox.style.height = `${rect.height}px`;
    state.highlightBox.style.opacity = "1";

    state.label.style.left = `${Math.max(8, rect.left)}px`;
    state.label.style.top = `${Math.max(8, rect.top - 28)}px`;
    state.label.style.opacity = "1";
    state.label.textContent = describeElement(element);
  }

  function describeElement(element) {
    const parts = [element.tagName.toLowerCase()];
    if (element.id) {
      parts.push(`#${element.id}`);
    }
    for (const className of Array.from(element.classList).slice(0, 2)) {
      parts.push(`.${className}`);
    }
    return parts.join("");
  }

  function updateHint(text) {
    if (state.hintBar) {
      state.hintBar.textContent = text;
    }
  }

  function teardownAll() {
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    if (state.relayoutRafId) {
      window.cancelAnimationFrame(state.relayoutRafId);
      state.relayoutRafId = null;
    }
    if (state.renderRafId) {
      window.cancelAnimationFrame(state.renderRafId);
      state.renderRafId = null;
    }
    if (state.pendingRelayoutTimeout) {
      window.clearTimeout(state.pendingRelayoutTimeout);
      state.pendingRelayoutTimeout = null;
    }

    cleanupObservers();
    removeAllListeners();
    restoreHiddenElements();
    destroyOverlay();

    state.mode = MODE.IDLE;
    state.currentCandidate = null;
    state.selectedRoot = null;
    state.columnCount = 2;
    state.layout = null;
    state.scrollProgress = 0;
    state.targetScrollProgress = 0;
    state.maxScrollProgress = 0;
    state.contentHeight = 0;
    state.imageLoadHandler = null;
    state.lastMetaUpdateTime = 0;
  }

  function isOverlayElement(element) {
    return Boolean(state.overlayRoot && (element === state.overlayRoot || state.overlayRoot.contains(element)));
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function overlapSize(startA, endA, startB, endB) {
    return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
