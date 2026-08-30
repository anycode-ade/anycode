export interface AnycodeLine extends HTMLDivElement {
    lineNumber: number;
    hash: number | string;
}

export interface GutterElement extends HTMLDivElement {
    lineNumber: number;
}

export interface ButtonColumnElement extends HTMLDivElement {
    lineNumber: number;
}

export interface FoldColumnElement extends HTMLDivElement {
    lineNumber: number;
}

export interface FoldElement extends HTMLButtonElement {
    lineNumber: number;
}

export interface RealRowElements {
    code: AnycodeLine;
    gutter: GutterElement;
    btn: ButtonColumnElement;
    fold: FoldColumnElement;
}

export interface RowElements {
    code: HTMLElement;
    gutter: HTMLElement;
    btn: HTMLElement;
    fold: HTMLElement;
}

export interface SideLineElement extends HTMLDivElement {
    lineNumber: number;
}

export interface GhostElement extends HTMLElement {
    isGhost: true;
    hunkId: number;
    originalLineIndex?: number;
}

export interface SparseGhostGroup {
    anchorLine: number;
    hunkId: number;
    oldLineNumbers: number[];
    ghostCount: number;
    startVisualIndex: number;
}

export type Pos = { row: number; col: number };

export interface Point {
    row: number;
    column: number;
}

export interface BracketMatch {
    openOffset: number;
    closeOffset: number;
}
