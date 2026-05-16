export type DiffViewMode = 'plain' | 'diff' | 'combine';

export const DIFF_VIEW_MODES: readonly DiffViewMode[] = ['plain', 'diff', 'combine'];
export const DEFAULT_DIFF_VIEW_MODE: DiffViewMode = 'plain';

export const getNextDiffMode = (mode: DiffViewMode): DiffViewMode => {
    const currentIndex = DIFF_VIEW_MODES.indexOf(mode);
    if (currentIndex === -1) {
        return DEFAULT_DIFF_VIEW_MODE;
    }

    const nextIndex = (currentIndex + 1) % DIFF_VIEW_MODES.length;
    return DIFF_VIEW_MODES[nextIndex];
};
