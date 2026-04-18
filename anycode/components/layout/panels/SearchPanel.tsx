import React from 'react';
import { type IDockviewPanelProps } from 'dockview';
import Search from '../../Search';
import { SearchPanelContext, useRequiredContext } from '../contexts';

export const SearchPanel: React.FC<IDockviewPanelProps> = () => {
    const ctx = useRequiredContext(SearchPanelContext, 'SearchPanelContext');

    return (
        <Search
            id="search-pane"
            onEnter={ctx.onSearch}
            onCancel={ctx.search.cancelSearch}
            results={ctx.search.searchResults}
            searchEnded={ctx.search.searchEnded}
            onMatchClick={ctx.onMatchClick}
        />
    );
};
