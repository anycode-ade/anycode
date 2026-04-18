import React from 'react';
import { type IDockviewPanelProps } from 'dockview';
import { ChangesPanel as GitChangesPanel } from '../../ChangesPanel';
import { ChangesPanelContext, useRequiredContext } from '../contexts';

export const ChangesPanel: React.FC<IDockviewPanelProps> = () => {
    const ctx = useRequiredContext(ChangesPanelContext, 'ChangesPanelContext');

    return (
        <GitChangesPanel
            files={ctx.git.changedFiles}
            branch={ctx.git.gitBranch}
            onFileClick={ctx.openFileDiffInEditorPane}
            onRefresh={ctx.git.fetchGitStatus}
            onCommit={ctx.git.commit}
            onPush={ctx.git.push}
            onPull={ctx.git.pull}
            onRevert={ctx.git.revert}
        />
    );
};
