import React, { useState } from 'react';
import type { AgentPromptTemplate } from '../../types';
import { useAgentTemplates, agentTemplatesStore } from '../../features/agents/agentTemplatesStore';
import { AcpIcons } from './AcpIcons';
import './AgentTemplatesManager.css';

interface AgentTemplatesManagerProps {
  embedded?: boolean;
}

export const AgentTemplatesManager: React.FC<AgentTemplatesManagerProps> = ({ embedded = false }) => {
  const templates = useAgentTemplates();
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newText, setNewText] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editText, setEditText] = useState('');

  const handleStartAdd = () => {
    setNewLabel('');
    setNewText('');
    setIsAdding(true);
  };

  const handleSaveNew = () => {
    const trimmedLabel = newLabel.trim();
    if (!trimmedLabel) return;

    agentTemplatesStore.add({
      label: trimmedLabel,
      text: newText.trim() || trimmedLabel,
    });

    setNewLabel('');
    setNewText('');
    setIsAdding(false);
  };

  const handleCancelNew = () => {
    setIsAdding(false);
    setNewLabel('');
    setNewText('');
  };

  const handleStartEdit = (template: AgentPromptTemplate) => {
    setEditingId(template.id);
    setEditLabel(template.label);
    setEditText(template.text || template.label);
  };

  const handleSaveEdit = (id: string) => {
    const trimmedLabel = editLabel.trim();
    if (!trimmedLabel) return;

    agentTemplatesStore.update(id, {
      label: trimmedLabel,
      text: editText.trim() || trimmedLabel,
    });

    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    agentTemplatesStore.remove(id);
  };

  const handleMoveUp = (index: number) => {
    if (index > 0) {
      agentTemplatesStore.reorder(index, index - 1);
    }
  };

  const handleMoveDown = (index: number) => {
    if (index < templates.length - 1) {
      agentTemplatesStore.reorder(index, index + 1);
    }
  };

  return (
    <div className={`agent-templates-manager ${embedded ? 'embedded' : ''}`}>
      <div className="agent-templates-manager-header">
        <div>
          <h4 className="agent-templates-title">Prompt Templates</h4>
          <p className="agent-templates-desc">
            Quick prompts shown when an agent session has no messages yet.
          </p>
        </div>
        <div className="agent-templates-header-actions">
          <button
            type="button"
            className="agent-templates-btn secondary"
            onClick={() => agentTemplatesStore.resetToDefaults()}
            title="Reset to default templates"
          >
            Reset Defaults
          </button>
          {!isAdding && (
            <button
              type="button"
              className="agent-templates-btn primary"
              onClick={handleStartAdd}
            >
              <AcpIcons.Add />
              Add Template
            </button>
          )}
        </div>
      </div>

      {isAdding && (
        <div className="agent-template-form-card">
          <div className="agent-template-form-title">New Template</div>
          <div className="agent-template-form-fields">
            <div className="agent-template-field">
              <label>Label (short text for button):</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Explain current diff"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handleSaveNew();
                  } else if (e.key === 'Escape') {
                    handleCancelNew();
                  }
                }}
              />
            </div>
            <div className="agent-template-field">
              <label>Text (full prompt sent to agent, can be long):</label>
              <textarea
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="e.g. Please carefully examine the git diff and provide a breakdown of changes... (leave empty to use label)"
                rows={4}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handleSaveNew();
                  } else if (e.key === 'Escape') {
                    handleCancelNew();
                  }
                }}
              />
            </div>
          </div>
          <div className="agent-template-form-actions">
            <button
              type="button"
              className="agent-templates-btn secondary"
              onClick={handleCancelNew}
            >
              Cancel
            </button>
            <button
              type="button"
              className="agent-templates-btn primary"
              onClick={handleSaveNew}
              disabled={!newLabel.trim()}
            >
              Save Template
            </button>
          </div>
        </div>
      )}

      <div className="agent-templates-list">
        {templates.length === 0 ? (
          <div className="agent-templates-empty">
            No templates configured yet. Click &quot;Add Template&quot; or &quot;Reset Defaults&quot;.
          </div>
        ) : (
          templates.map((template, index) => {
            const isEditing = editingId === template.id;

            if (isEditing) {
              return (
                <div key={template.id} className="agent-template-form-card editing">
                  <div className="agent-template-form-title">Edit Template</div>
                  <div className="agent-template-form-fields">
                    <div className="agent-template-field">
                      <label>Label (short text for button):</label>
                      <input
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            handleSaveEdit(template.id);
                          } else if (e.key === 'Escape') {
                            handleCancelEdit();
                          }
                        }}
                      />
                    </div>
                    <div className="agent-template-field">
                      <label>Text (full prompt sent to agent):</label>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={4}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            handleSaveEdit(template.id);
                          } else if (e.key === 'Escape') {
                            handleCancelEdit();
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="agent-template-form-actions">
                    <button
                      type="button"
                      className="agent-templates-btn secondary"
                      onClick={handleCancelEdit}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="agent-templates-btn primary"
                      onClick={() => handleSaveEdit(template.id)}
                      disabled={!editLabel.trim()}
                    >
                      Save
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={template.id} className="agent-template-item">
                <div className="agent-template-item-content">
                  <div className="agent-template-item-title">{template.label}</div>
                  {template.text && template.text !== template.label && (
                    <div className="agent-template-item-prompt">{template.text}</div>
                  )}
                </div>
                <div className="agent-template-item-actions">
                  <button
                    type="button"
                    className="agent-template-icon-btn"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    title="Move up"
                  >
                    <AcpIcons.ChevronUp />
                  </button>
                  <button
                    type="button"
                    className="agent-template-icon-btn"
                    onClick={() => handleMoveDown(index)}
                    disabled={index === templates.length - 1}
                    title="Move down"
                  >
                    <AcpIcons.ChevronDown />
                  </button>
                  <button
                    type="button"
                    className="agent-template-icon-btn"
                    onClick={() => handleStartEdit(template)}
                    title="Edit template"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="agent-template-icon-btn danger"
                    onClick={() => handleDelete(template.id)}
                    title="Delete template"
                  >
                    <AcpIcons.CloseSmall />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
