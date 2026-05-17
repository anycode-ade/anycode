export type DiffMode = 'plain' | 'diff' | 'combine';

export const DIFF_VIEW_MODES: readonly DiffMode[] = ['plain', 'diff', 'combine'];
export const DEFAULT_DIFF_VIEW_MODE: DiffMode = 'plain';

export const getNextDiffMode = (mode: DiffMode): DiffMode => {
    const currentIndex = DIFF_VIEW_MODES.indexOf(mode);
    if (currentIndex === -1) {
        return DEFAULT_DIFF_VIEW_MODE;
    }

    const nextIndex = (currentIndex + 1) % DIFF_VIEW_MODES.length;
    return DIFF_VIEW_MODES[nextIndex];
};
