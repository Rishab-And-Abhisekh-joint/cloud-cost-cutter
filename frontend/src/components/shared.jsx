import { useState, useMemo, useCallback } from "react";

const SORT_ASC = "asc";
const SORT_DESC = "desc";

export function StatusBadge({ level, label }) {
  const map = {
    critical: "badge-critical",
    high: "badge-high",
    medium: "badge-medium",
    low: "badge-low",
    success: "badge-success",
    info: "badge-info",
    warning: "badge-warning",
    neutral: "badge-neutral",
  };
  const cls = map[String(level).toLowerCase()] || "badge-neutral";
  return <span className={`status-badge ${cls}`}>{label || level}</span>;
}

export function RiskBadge({ risk }) {
  const level = String(risk || "low").toLowerCase();
  const labels = { critical: "Critical", high: "High", medium: "Med", low: "Low" };
  return <StatusBadge level={level} label={labels[level] || level} />;
}

export function MetricCard({ label, value, delta, deltaDirection, helper, icon, iconVariant, children }) {
  const deltaClass = deltaDirection === "up" ? "metric-delta-up" : deltaDirection === "down" ? "metric-delta-down" : "metric-delta-neutral";
  const iconCls = iconVariant ? `metric-icon metric-icon-${iconVariant}` : "metric-icon";
  return (
    <article className="metric-card">
      <div className="metric-card-top">
        {icon && <span className={iconCls}>{icon}</span>}
        <div className="metric-card-text">
          <p className="metric-label">{label}</p>
          <div className="metric-value-row">
            <p className="metric-value">{value}</p>
            {delta != null && (
              <span className={`metric-delta ${deltaClass}`}>
                {deltaDirection === "up" && "↑"}
                {deltaDirection === "down" && "↓"}
                {delta}
              </span>
            )}
          </div>
          {helper && <p className="metric-helper">{helper}</p>}
        </div>
      </div>
      {children && <div className="metric-card-extra">{children}</div>}
    </article>
  );
}

export function FilterBar({ filters, values, onChange, searchPlaceholder, searchValue, onSearchChange, onClearAll }) {
  const activeChips = [];
  if (filters) {
    filters.forEach((f) => {
      const val = values[f.key];
      if (val) {
        const opt = f.options.find((o) => o.value === val);
        activeChips.push({ key: f.key, label: f.label, value: opt ? opt.label : val });
      }
    });
  }
  if (searchValue) {
    activeChips.push({ key: "__search__", label: "Search", value: searchValue });
  }

  return (
    <div className="filter-bar-wrap">
      <div className="filter-bar">
        {filters && filters.map((f) => (
          <div className="filter-item" key={f.key}>
            <label className="filter-label">{f.label}</label>
            <select
              className="filter-select"
              value={values[f.key] || ""}
              onChange={(e) => onChange(f.key, e.target.value)}
            >
              <option value="">{f.allLabel || "All"}</option>
              {f.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        ))}
        {onSearchChange && (
          <div className="filter-item filter-search">
            <label className="filter-label">Search</label>
            <input
              className="filter-input"
              type="text"
              placeholder={searchPlaceholder || "Filter..."}
              value={searchValue || ""}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        )}
      </div>
      {activeChips.length > 0 && (
        <div className="filter-chips">
          {activeChips.map((chip) => (
            <span className="filter-chip" key={chip.key}>
              <span className="filter-chip-label">{chip.label}:</span> {chip.value}
              <button
                className="filter-chip-remove"
                onClick={() => {
                  if (chip.key === "__search__") {
                    onSearchChange("");
                  } else {
                    onChange(chip.key, "");
                  }
                }}
                aria-label={`Remove ${chip.label} filter`}
              >
                ×
              </button>
            </span>
          ))}
          {activeChips.length > 1 && onClearAll && (
            <button className="filter-chip-clear" onClick={onClearAll}>Clear all</button>
          )}
        </div>
      )}
    </div>
  );
}

export function DataTable({ columns, data, onRowClick, emptyMessage, rowKeyField, expandedContent, stickyHeader, selectable, selectedKeys, onSelectionChange }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState(SORT_ASC);
  const [expandedRow, setExpandedRow] = useState(null);
  const sel = selectable ? (selectedKeys || []) : null;

  const handleSort = useCallback((colKey) => {
    if (sortCol === colKey) {
      setSortDir((prev) => (prev === SORT_ASC ? SORT_DESC : SORT_ASC));
    } else {
      setSortCol(colKey);
      setSortDir(SORT_ASC);
    }
  }, [sortCol]);

  const sortedData = useMemo(() => {
    if (!sortCol || !data) return data || [];
    const col = columns.find((c) => c.key === sortCol);
    if (!col) return data;
    const sorted = [...data].sort((a, b) => {
      const va = col.sortValue ? col.sortValue(a) : a[sortCol];
      const vb = col.sortValue ? col.sortValue(b) : b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return va - vb;
      return String(va).localeCompare(String(vb));
    });
    return sortDir === SORT_DESC ? sorted.reverse() : sorted;
  }, [data, sortCol, sortDir, columns]);

  const getRowKey = useCallback((row, idx) => {
    return rowKeyField ? row[rowKeyField] : idx;
  }, [rowKeyField]);

  const toggleSelection = useCallback((key) => {
    if (!onSelectionChange) return;
    const next = sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key];
    onSelectionChange(next);
  }, [sel, onSelectionChange]);

  const toggleSelectAll = useCallback(() => {
    if (!onSelectionChange || !sortedData.length) return;
    const allKeys = sortedData.map((row, idx) => getRowKey(row, idx));
    const allSelected = allKeys.every((k) => sel.includes(k));
    onSelectionChange(allSelected ? [] : allKeys);
  }, [sel, onSelectionChange, sortedData, getRowKey]);

  const handleRowClick = useCallback((row, idx) => {
    if (expandedContent) {
      const key = getRowKey(row, idx);
      setExpandedRow((prev) => (prev === key ? null : key));
    }
    if (onRowClick) onRowClick(row);
  }, [onRowClick, expandedContent, getRowKey]);

  if (!sortedData.length) {
    return <div className="dt-empty">{emptyMessage || "No data available"}</div>;
  }

  return (
    <div className={`dt-wrapper ${stickyHeader ? "dt-sticky" : ""}`}>
      <table className="dt-table">
        <thead>
          <tr className="dt-head-row">
            {sel && (
              <th className="dt-th dt-th-check" style={{ width: "36px", minWidth: "36px" }}>
                <input
                  type="checkbox"
                  checked={sortedData.length > 0 && sortedData.every((r, i) => sel.includes(getRowKey(r, i)))}
                  onChange={toggleSelectAll}
                  aria-label="Select all rows"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`dt-th ${col.sortable !== false ? "dt-sortable" : ""} ${col.align === "right" ? "dt-right" : ""}`}
                style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
              >
                <span className="dt-th-text">
                  {col.header}
                  {sortCol === col.key && (
                    <span className="dt-sort-indicator">{sortDir === SORT_ASC ? "↑" : "↓"}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, idx) => {
            const key = getRowKey(row, idx);
            const isExpanded = expandedContent && expandedRow === key;
            const isSelected = sel ? sel.includes(key) : false;
            return (
              <DataTableRowGroup
                key={key}
                row={row}
                columns={columns}
                isExpanded={isExpanded}
                expandedContent={expandedContent}
                onClick={() => handleRowClick(row, idx)}
                clickable={!!onRowClick || !!expandedContent}
                selectable={!!sel}
                isSelected={isSelected}
                onToggleSelect={() => toggleSelection(key)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataTableRowGroup({ row, columns, isExpanded, expandedContent, onClick, clickable, selectable, isSelected, onToggleSelect }) {
  const colCount = columns.length + (selectable ? 1 : 0);
  return (
    <>
      <tr className={`dt-row ${clickable ? "dt-clickable" : ""} ${isExpanded ? "dt-expanded" : ""} ${isSelected ? "dt-selected" : ""}`} onClick={onClick}>
        {selectable && (
          <td className="dt-td dt-td-check">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
              onClick={(e) => e.stopPropagation()}
              aria-label="Select row"
            />
          </td>
        )}
        {columns.map((col) => (
          <td
            key={col.key}
            className={`dt-td ${col.align === "right" ? "dt-right" : ""}`}
          >
            {col.render ? col.render(row[col.key], row) : row[col.key]}
          </td>
        ))}
      </tr>
      {isExpanded && expandedContent && (
        <tr className="dt-expand-row">
          <td colSpan={colCount} className="dt-expand-cell">
            {expandedContent(row)}
          </td>
        </tr>
      )}
    </>
  );
}

export function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <div className="page-header-v2">
      <div className="page-header-text">
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h2 className="page-title-v2">{title}</h2>
        {subtitle && <p className="page-subtitle-v2">{subtitle}</p>}
      </div>
      {children && <div className="page-header-actions-v2">{children}</div>}
    </div>
  );
}

export function SectionCard({ title, badge, actions, children, noPadding, className }) {
  return (
    <article className={`section-card ${className || ""}`}>
      {(title || badge || actions) && (
        <div className="section-card-header">
          <div className="section-card-header-left">
            {title && <h3 className="section-card-title">{title}</h3>}
            {badge && <span className="section-card-badge">{badge}</span>}
          </div>
          {actions && <div className="section-card-actions">{actions}</div>}
        </div>
      )}
      <div className={noPadding ? "section-card-body-flush" : "section-card-body"}>
        {children}
      </div>
    </article>
  );
}

export function EmptyState({ icon, message, action }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <p className="empty-state-text">{message}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function CountBadge({ count, variant }) {
  const cls = variant ? `count-badge count-badge-${variant}` : "count-badge";
  return <span className={cls}>{count}</span>;
}

export function TabBar({ tabs, activeTab, onTabChange }) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={activeTab === tab.key}
          className={`tab-bar-item ${activeTab === tab.key ? "tab-bar-active" : ""}`}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.icon && <span className="tab-bar-icon">{tab.icon}</span>}
          {tab.label}
          {tab.count != null && <CountBadge count={tab.count} />}
        </button>
      ))}
    </div>
  );
}

export function ConfirmModal({ open, title, message, confirmLabel, cancelLabel, risk, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title || "Confirm Action"}</h3>
        {risk && (
          <div className="modal-risk">
            <RiskBadge risk={risk} /> <span>This action carries {risk} risk</span>
          </div>
        )}
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>{cancelLabel || "Cancel"}</button>
          <button type="button" className={risk === "high" || risk === "critical" ? "btn-danger" : "solid"} onClick={onConfirm}>
            {confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
