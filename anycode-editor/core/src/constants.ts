export const CSS_CLASS = {
    LINE: "line",
    GUTTER: "ln",
    BUTTONS: "bt",
    FOLDS: "fd",
    SPACER: "spacer",

    // Diff Gaps / Separators
    DIFF_GAP: "diff-gap",
    DIFF_GAP_GUTTER: "diff-gap-gutter",
    DIFF_GAP_BTN: "diff-gap-btn",
    DIFF_GAP_EXPAND_BTN: "diff-gap-expand-btn",
    DIFF_GAP_EXPAND_BTN_LABEL: "diff-gap-expand-btn-label",
    DIFF_GAP_GUTTER_BTN: "diff-gap-gutter-btn",
    DIFF_GAP_GUTTER_BTN_UP: "diff-gap-gutter-btn-up",
    DIFF_GAP_GUTTER_BTN_DOWN: "diff-gap-gutter-btn-down",
    FOLD_GAP_CELL: "fold-gap-cell",

    // Ghost rows
    LINE_DELETED_GHOST: "line-deleted-ghost",

    // Folding
    FOLD_TOGGLE: "fold-toggle",
    COLLAPSED: "collapsed",
    EXPANDED: "expanded",

    // Diff modifications
    DIFF_CHANGED: "diff-changed",
    DIFF_ADDED: "diff-added",
    DIFF_DELETED: "diff-deleted",

    // Scrollbar Markers
    SMR: "smr",
    SMRT: "smrt",
    SMR_ACTIVE: "smr-active",
    SMR_VISIBLE: "visible",
    SMR_DRAGGING: "dragging",
    SMR_STYLE_ROUNDED: "style-rounded",
    SMR_STYLE_FLAT: "style-flat",

    // Scrollbar Marker Layers
    SMR_DIFF_LAYER: "smrdl",
    SMR_WORD_LAYER: "smrwl",
    SMR_SEARCH_LAYER: "smrsl",
    SMR_ERROR_LAYER: "smrel",

    // Scrollbar Marker Elements
    SMR_MARKER: "smrm",
    SMR_DIFF: "smrd",
    SMR_WORD: "smrw",
    SMR_SEARCH: "smrs",
    SMR_ERROR: "smre",
} as const;
