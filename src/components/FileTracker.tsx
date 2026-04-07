'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  ChevronDown,
  Search,
  FileText,
  Image,
  Video,
  Music,
  ChevronRight,
  Check,
  AlertCircle,
  Clock,
  Zap,
  Archive,
  Eye,
  Edit2,
  Calendar,
} from 'lucide-react';
import { StatusBadge } from './StatusBadge';

export interface TrackedFile {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  batch_name: string;
  brand_name: string;
  brand_id: string;
  creator_name: string;
  creative_type: string;
  landing_page_url: string;
  copy_headline: string;
  status: string;
  media_format: string;
  aspect_ratio: string;
  is_carousel: boolean;
  is_flexible: boolean;
  is_whitelist: boolean;
  creator_social_handle: string;
  launch_date: string | null;
  launch_time: string | null;
  ad_name: string | null;
  notes: string | null;
  submitted_at: string;
  submission_id: string;
}

export interface Brand {
  id: string;
  name: string;
}

export interface FileTrackerProps {
  files: TrackedFile[];
  brands: Brand[];
  isAdmin: boolean;
  onStatusChange: (fileId: string, status: string) => Promise<void>;
  onFieldUpdate: (fileId: string, field: string, value: unknown) => Promise<void>;
  isLoading?: boolean;
}

const STATUSES = [
  'Draft',
  'Submitted',
  'In Review',
  'Approved',
  'Rejected',
  'Live',
  'Archived',
];

const FileTracker: React.FC<FileTrackerProps> = ({
  files,
  brands,
  isAdmin,
  onStatusChange,
  onFieldUpdate,
  isLoading = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupByBatch, setGroupByBatch] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(
    new Set()
  );

  const getFileIcon = (fileType: string) => {
    const type = fileType.toLowerCase();
    if (type.includes('image')) return <Image className="w-4 h-4" />;
    if (type.includes('video')) return <Video className="w-4 h-4" />;
    if (type.includes('audio') || type.includes('music'))
      return <Music className="w-4 h-4" />;
    return <FileText className="w-4 h-4" />;
  };

  const filteredFiles = useMemo(() => {
    let result = files;

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(
        (f) =>
          f.file_name.toLowerCase().includes(lower) ||
          f.batch_name.toLowerCase().includes(lower)
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter((f) => f.status === statusFilter);
    }

    if (isAdmin && brandFilter !== 'all') {
      result = result.filter((f) => f.brand_id === brandFilter);
    }

    if (dateFrom) {
      result = result.filter((f) => f.launch_date && f.launch_date >= dateFrom);
    }

    if (dateTo) {
      result = result.filter((f) => f.launch_date && f.launch_date <= dateTo);
    }

    if (sortColumn) {
      result.sort((a, b) => {
        const aVal = (a[sortColumn as keyof TrackedFile] ?? '').toString();
        const bVal = (b[sortColumn as keyof TrackedFile] ?? '').toString();
        const cmp = aVal.localeCompare(bVal);
        return sortAsc ? cmp : -cmp;
      });
    }

    return result;
  }, [
    files,
    searchTerm,
    statusFilter,
    brandFilter,
    isAdmin,
    dateFrom,
    dateTo,
    sortColumn,
    sortAsc,
  ]);

  const groupedFiles = useMemo(() => {
    if (!groupByBatch) return null;

    const groups: Record<string, TrackedFile[]> = {};
    filteredFiles.forEach((file) => {
      if (!groups[file.batch_name]) groups[file.batch_name] = [];
      groups[file.batch_name].push(file);
    });
    return groups;
  }, [filteredFiles, groupByBatch]);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortAsc(!sortAsc);
    } else {
      setSortColumn(column);
      setSortAsc(true);
    }
  };

  const handleCellEdit = (fileId: string, field: string, currentValue: unknown) => {
    setEditingCell(`${fileId}-${field}`);
    setEditValue(currentValue?.toString() ?? '');
  };

  const handleSaveEdit = async (fileId: string, field: string) => {
    setSavingCell(`${fileId}-${field}`);
    try {
      await onFieldUpdate(fileId, field, editValue);
      setEditingCell(null);
    } catch (error) {
      console.error('Failed to update field:', error);
    } finally {
      setSavingCell(null);
    }
  };

  const handleStatusChange = async (fileId: string, newStatus: string) => {
    setSavingCell(`${fileId}-status`);
    try {
      await onStatusChange(fileId, newStatus);
      setEditingCell(null);
    } catch (error) {
      console.error('Failed to update status:', error);
    } finally {
      setSavingCell(null);
    }
  };

  const toggleBatchExpand = (batchName: string) => {
    const newExpanded = new Set(expandedBatches);
    if (newExpanded.has(batchName)) {
      newExpanded.delete(batchName);
    } else {
      newExpanded.add(batchName);
    }
    setExpandedBatches(newExpanded);
  };

  const hasActiveFilters =
    searchTerm ||
    statusFilter !== 'all' ||
    brandFilter !== 'all' ||
    dateFrom ||
    dateTo;

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setBrandFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const renderEditableCell = (
    file: TrackedFile,
    field: string,
    displayValue: React.ReactNode
  ) => {
    const cellKey = `${file.id}-${field}`;
    const isEditing = editingCell === cellKey;
    const isSaving = savingCell === cellKey;

    if (!isAdmin) {
      return <span className="text-sm text-#F5F5F8">{displayValue}</span>;
    }

    return (
      <div className="relative group flex items-center gap-2">
        {isEditing ? (
          <div className="flex items-center gap-2 w-full">
            {field === 'notes' ? (
              <textarea
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="text-sm bg-#1A1A1A border border-#D4A574 rounded px-2 py-1 text-#F5F5F8 focus:outline-none flex-1"
                rows={2}
              />
            ) : (
              <input
                autoFocus
                type={field === 'launch_date' ? 'date' : 'text'}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="text-sm bg-#1A1A1A border border-#D4A574 rounded px-2 py-1 text-#F5F5F8 focus:outline-none flex-1"
              />
            )}
            <button
              onClick={() => handleSaveEdit(file.id, field)}
              className="text-#D4A574 hover:text-#FFF8F0"
            >
              <Check className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <span className="text-sm text-#F5F5F8">{displayValue}</span>
            {!isSaving && (
              <Edit2 className="w-4 h-4 text-#D4A574 opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity" />
            )}
            {isSaving && (
              <div className="w-2 h-2 rounded-full bg-#D4A574 animate-pulse" />
            )}
          </>
        )}
      </div>
    );
  };

  const renderStatusCell = (file: TrackedFile) => {
    const cellKey = `${file.id}-status`;
    const isEditing = editingCell === cellKey;
    const isSaving = savingCell === cellKey;

    if (!isAdmin) {
      return <StatusBadge status={file.status} />;
    }

    if (isEditing) {
      return (
        <div className="flex gap-2">
          <select
            autoFocus
            value={file.status}
            onChange={(e) => handleStatusChange(file.id, e.target.value)}
            className="text-sm bg-#1A1A1A border border-#D4A574 rounded px-2 py-1 text-#F5F5F8 focus:outline-none"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div className="relative group flex items-center gap-2">
        <div
          className="cursor-pointer"
          onClick={() => handleCellEdit(file.id, 'status', file.status)}
        >
          <StatusBadge status={file.status} />
        </div>
        {!isSaving && (
          <Edit2 className="w-4 h-4 text-#D4A574 opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity" />
        )}
        {isSaving && (
          <div className="w-2 h-2 rounded-full bg-#D4A574 animate-pulse" />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-#ABABAB" />
          <input
            type="text"
            placeholder="Search by file name or batch..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-#1A1A1A border border-#ffffff14 rounded-lg text-#F5F5F8 placeholder-#ABABAB focus:outline-none focus:border-#D4A574"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-#1A1A1A text-#F5F5F8 border border-#ffffff14 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-#D4A574"
          >
            <option value="all">All Statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {isAdmin && (
            <select
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              className="bg-#1A1A1A text-#F5F5F8 border border-#ffffff14 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-#D4A574"
            >
              <option value="all">All Brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-#1A1A1A text-#F5F5F8 border border-#ffffff14 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-#D4A574"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-#1A1A1A text-#F5F5F8 border border-#ffffff14 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-#D4A574"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={groupByBatch}
              onChange={(e) => setGroupByBatch(e.target.checked)}
              className="w-4 h-4 rounded bg-#1A1A1A border border-#D4A574 cursor-pointer"
            />
            <span className="text-sm text-#ABABAB">Group by Batch</span>
          </label>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-sm text-#D4A574 hover:text-#FFF8F0 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Row Count */}
      <div className="text-xs text-#ABABAB">
        Showing {filteredFiles.length} of {files.length} files
      </div>

      {/* Table */}
      <div className="bg-#0d0d0d bg-opacity-50 backdrop-blur border border-#ffffff14 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="sticky top-0 bg-#0D0D0D border-b border-#ffffff14">
                {groupByBatch && <th className="w-8"></th>}
                {[
                  'File Name',
                  'Batch',
                  'Brand',
                  'Creator',
                  'Type',
                  'Status',
                  'Launch Date',
                  'Launch Time',
                  'Ad Name',
                  'Notes',
                ].map((header) => (
                  <th
                    key={header}
                    onClick={() => handleSort(header.toLowerCase().replace(' ', '_'))}
                    className="px-4 py-3 text-left text-xs font-semibold text-#ABABAB cursor-pointer hover:text-#D4A574 transition-colors"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupByBatch && groupedFiles
                ? Object.entries(groupedFiles).map(([batchName, batchFiles]) => (
                    <React.Fragment key={batchName}>
                      <tr className="bg-#0D0D0D border-b border-#ffffff14 hover:bg-#ffffff05">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleBatchExpand(batchName)}
                            className="text-#D4A574"
                          >
                            <ChevronRight
                              className={`w-4 h-4 transition-transform ${
                                expandedBatches.has(batchName) ? 'rotate-90' : ''
                              }`}
                            />
                          </button>
                        </td>
                        <td colSpan={10} className="px-4 py-3">
                          <span className="text-sm font-semibold text-#D4A574 bg-#D4A574 bg-opacity-10 px-3 py-1 rounded-full">
                            {batchName} ({batchFiles.length})
                          </span>
                        </td>
                      </tr>
                      {expandedBatches.has(batchName) &&
                        batchFiles.map((file) => (
                          <FileRow
                            key={file.id}
                            file={file}
                            isAdmin={isAdmin}
                            getFileIcon={getFileIcon}
                            renderEditableCell={renderEditableCell}
                            renderStatusCell={renderStatusCell}
                            handleCellEdit={handleCellEdit}
                            groupByBatch={true}
                          />
                        ))}
                    </React.Fragment>
                  ))
                : filteredFiles.map((file) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      isAdmin={isAdmin}
                      getFileIcon={getFileIcon}
                      renderEditableCell={renderEditableCell}
                      renderStatusCell={renderStatusCell}
                      handleCellEdit={handleCellEdit}
                      groupByBatch={false}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface FileRowProps {
  file: TrackedFile;
  isAdmin: boolean;
  getFileIcon: (fileType: string) => React.ReactNode;
  renderEditableCell: (
    file: TrackedFile,
    field: string,
    displayValue: React.ReactNode
  ) => React.ReactNode;
  renderStatusCell: (file: TrackedFile) => React.ReactNode;
  handleCellEdit: (fileId: string, field: string, currentValue: unknown) => void;
  groupByBatch: boolean;
}

const FileRow: React.FC<FileRowProps> = ({
  file,
  isAdmin,
  getFileIcon,
  renderEditableCell,
  renderStatusCell,
  handleCellEdit,
  groupByBatch,
}) => {
  return (
    <tr className="border-b border-#ffffff14 hover:bg-#ffffff05 transition-colors">
      {groupByBatch && <td className="px-4 py-3"></td>}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="text-#D4A574">{getFileIcon(file.file_type)}</div>
          <span className="text-sm text-#F5F5F8 truncate">{file.file_name}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-#D4A574 bg-#D4A574 bg-opacity-10 px-2 py-1 rounded">
          {file.batch_name}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-#F5F5F8">{file.brand_name}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-#F5F5F8">{file.creator_name}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-#F5F5F8 bg-#ffffff08 px-2 py-1 rounded">
          {file.creative_type}
        </span>
      </td>
      <td className="px-4 py-3">{renderStatusCell(file)}</td>
      <td className="px-4 py-3">
        {renderEditableCell(file, 'launch_date', file.launch_date || '-')}
      </td>
      <td className="px-4 py-3">
        {renderEditableCell(file, 'launch_time', file.launch_time || '-')}
      </td>
      <td className="px-4 py-3">
        {renderEditableCell(file, 'ad_name', file.ad_name || '-')}
      </td>
      <td className="px-4 py-3">
        {renderEditableCell(file, 'notes', file.notes || '-')}
      </td>
    </tr>
  );
};

export default FileTracker;
