import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from './Icons';
import './ProjectSwitcher.css';

export interface ProjectSwitcherOption {
    id: string;
    name: string;
}

interface ProjectSwitcherProps {
    options: ProjectSwitcherOption[];
    value: string;
    onChange: (projectId: string) => void;
    onAddProject?: (anchor: HTMLElement) => void;
    // While the add-folder picker is open it is anchored to this chevron, so the menu must stay shut.
    disabled?: boolean;
}

interface MenuPosition {
    top: number;
    right: number;
    maxWidth: number;
}

export const ProjectSwitcher: React.FC<ProjectSwitcherProps> = ({ options, value, onChange, onAddProject, disabled }) => {
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const isOpen = menuPosition !== null;
    const current = options.find((option) => option.id === value) ?? options[0];

    const closeMenu = () => setMenuPosition(null);

    const toggleMenu = () => {
        if (isOpen) {
            closeMenu();
            return;
        }
        const trigger = triggerRef.current?.getBoundingClientRect();
        const row = triggerRef.current?.parentElement?.getBoundingClientRect();
        if (!trigger || !row) return;
        // Open below the chevron, right-aligned to it; never wider than the project row.
        setMenuPosition({ top: trigger.bottom + 4, right: window.innerWidth - trigger.right, maxWidth: row.width });
    };

    useEffect(() => {
        if (!isOpen) return;

        // Capture phase: the tree row stops bubbling mousedown, so a bubble listener would miss outside clicks.
        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            closeMenu();
        };
        const handleScroll = (event: Event) => {
            if (menuRef.current?.contains(event.target as Node)) return;
            closeMenu();
        };

        document.addEventListener('mousedown', handleMouseDown, true);
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', closeMenu);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown, true);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', closeMenu);
        };
    }, [isOpen]);

    const selectOption = (projectId: string) => {
        closeMenu();
        triggerRef.current?.focus();
        if (projectId !== value) onChange(projectId);
    };

    const addProject = () => {
        closeMenu();
        if (triggerRef.current && onAddProject) onAddProject(triggerRef.current);
    };

    return (
        <>
            <div className="project-switcher">
                {/* Only the chevron opens the menu; the name behaves like a plain project row. */}
                <span className="project-switcher-name" title={current?.name}>{current?.name}</span>
                <button
                    ref={triggerRef}
                    type="button"
                    className="project-switcher-trigger"
                    aria-label="Switch project"
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    disabled={disabled}
                    // Stop here so the tree row does not also toggle the project folder.
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        toggleMenu();
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape' && isOpen) {
                            event.stopPropagation();
                            closeMenu();
                        }
                    }}
                >
                    <Icons.ChevronDown />
                </button>
            </div>
            {isOpen && menuPosition && createPortal(
                <div
                    ref={menuRef}
                    role="menu"
                    aria-label="Projects"
                    className="project-switcher-menu"
                    style={{ top: menuPosition.top, right: menuPosition.right, maxWidth: menuPosition.maxWidth }}
                    // Portaled menu still bubbles through the React tree; keep clicks from reaching the tree row.
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.stopPropagation();
                            selectOption(value);
                        }
                    }}
                >
                    {options.map((option) => {
                        const isSelected = option.id === value;
                        return (
                            <button
                                key={option.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={isSelected}
                                className="project-switcher-option"
                                onClick={() => selectOption(option.id)}
                            >
                                <span className="project-switcher-option-name">{option.name}</span>
                                <span className="project-switcher-check" aria-hidden="true">
                                    {isSelected && <Icons.Check />}
                                </span>
                            </button>
                        );
                    })}
                    {onAddProject && (
                        <>
                            <div className="project-switcher-separator" role="separator" />
                            <button
                                type="button"
                                role="menuitem"
                                className="project-switcher-option"
                                onClick={addProject}
                            >
                                <span className="project-switcher-option-name">Add project folder…</span>
                                <span className="project-switcher-check" aria-hidden="true">
                                    <Icons.Plus size={12} />
                                </span>
                            </button>
                        </>
                    )}
                </div>,
                document.body,
            )}
        </>
    );
};
