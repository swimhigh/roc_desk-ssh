import React, { useState } from "react";
import type { ConnectionGroup } from "../../types/bindings";

interface GroupDialogProps {
  title: string;
  initial?: ConnectionGroup;
  initialParentId?: string | null;
  groups: ConnectionGroup[];
  onCancel: () => void;
  onSave: (value: { name: string; parentId: string | null }) => void;
}

/** 新建分组 / 重命名+移动分组共用的弹窗，原样搬自宿主
 * `src-web/src/components/RemoteTool/GroupDialog.tsx`。*/
export const GroupDialog: React.FC<GroupDialogProps> = ({ title, initial, initialParentId, groups, onCancel, onSave }) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [parentId, setParentId] = useState(initial ? (initial.parent_id ?? "") : (initialParentId ?? ""));

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true">
      <div className="dialog" style={{ minWidth: 360, maxWidth: 420 }}>
        <div className="dialog-title-bar info">
          <span>📁</span>
          <span>{title}</span>
        </div>
        <div className="dialog-body">
          <div className="form">
            <div className="form-row">
              <label className="form-label">名称</label>
              <input className="form-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="form-row">
              <label className="form-label">上级分组</label>
              <select className="form-select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">— 根目录 —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <button className="btn ghost sm" onClick={onCancel}>取消</button>
          <button
            className="btn primary sm"
            disabled={!name.trim()}
            onClick={() => onSave({ name: name.trim(), parentId: parentId || null })}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
