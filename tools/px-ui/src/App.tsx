import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { CELL_FLOOR, CellValue, Level } from '../../../src/levels/types';
import {
  FIRST_CURATED_LEVEL,
  MAX_STORED_BOARD_SIZE,
  MIN_STORED_BOARD_SIZE,
  rectangleMatrix,
  storedBoardSize,
} from '../../../src/procedural/CuratedGenerator';
import { fillLevelVacancies } from '../../../src/procedural/SLevelGenerator';
import { matrixFromRaster, Raster } from '../../../src/procedural/shapeFromImage';
import type { CatalogRow, GenerateProgress, StudioStatus } from './types';
import { Playfield } from './Playfield';
import { rasterFromFile } from './loadRaster';
import {
  canMerge,
  canSeparate,
  cloneLevel,
  deleteArrows,
  mergeArrows,
  separateArrows,
} from './editArrows';
import {
  applyTheme,
  DEFAULT_GENERATOR_SIZES,
  isValidBoardSize,
  loadStudioSettings,
  parseBoardSize,
  saveStudioSettings,
  sizeButtonList,
  StudioSettings,
  ThemeMode,
} from './studioSettings';

function errorText(caught: unknown): string {
  if (caught instanceof Error && caught.message) return caught.message;
  if (typeof caught === 'string' && caught.trim()) return caught;
  if (caught && typeof caught === 'object' && 'message' in caught) {
    const message = (caught as { message: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Something went wrong.';
}

export function App() {
  const initialSettings = useMemo(() => loadStudioSettings(), []);
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [panel, setPanel] = useState<'none' | 'generate' | 'single' | 'regenerate' | 'settings'>('none');
  const [settingsTab, setSettingsTab] = useState<'general' | 'generator' | 'supabase'>('general');
  const [settings, setSettings] = useState<StudioSettings>(initialSettings);
  const [draftTheme, setDraftTheme] = useState<ThemeMode>(initialSettings.theme);
  const [draftSizes, setDraftSizes] = useState<[string, string, string, string]>(
    initialSettings.generatorSizes.map(String) as [string, string, string, string],
  );
  const [settingsError, setSettingsError] = useState('');
  const [genFrom, setGenFrom] = useState('5');
  const [genCount, setGenCount] = useState('25');
  const [genQuality, setGenQuality] = useState<'fast' | 'normal' | 'quality'>('normal');
  const [genReplace, setGenReplace] = useState(false);
  const sizeChoices = useMemo(() => sizeButtonList(settings.generatorSizes), [settings.generatorSizes]);
  const [genSizes, setGenSizes] = useState<number[]>(() => [...sizeButtonList(initialSettings.generatorSizes)]);
  const [shapeFolder, setShapeFolder] = useState('');
  const [shapeFolderCount, setShapeFolderCount] = useState(0);
  const [alsoUseSquares, setAlsoUseSquares] = useState(false);
  const [singleLevel, setSingleLevel] = useState('1');
  const [singleName, setSingleName] = useState('');
  const [singleQuality, setSingleQuality] = useState<'fast' | 'normal' | 'quality'>('normal');
  const [singleReplace, setSingleReplace] = useState(false);
  const [singleSize, setSingleSize] = useState<number>(initialSettings.generatorSizes[0]);
  const [shapeRaster, setShapeRaster] = useState<Raster | null>(null);
  const [shapeMatrix, setShapeMatrix] = useState<CellValue[][] | null>(null);
  const [shapeFileName, setShapeFileName] = useState('');
  const [shapeFileBytes, setShapeFileBytes] = useState<number[] | null>(null);
  const [shapeError, setShapeError] = useState('');
  const [regenSpec, setRegenSpec] = useState('2-5');
  const [regenQuality, setRegenQuality] = useState<'fast' | 'normal' | 'quality'>('normal');
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudAnon, setCloudAnon] = useState('');
  const [cloudService, setCloudService] = useState('');
  const [schema, setSchema] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Level | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [playNonce, setPlayNonce] = useState(0);
  const [demoToken, setDemoToken] = useState(0);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [stopping, setStopping] = useState<'none' | 'now' | 'after'>('none');
  const [showOpen, setShowOpen] = useState(false);
  const [deleteMenu, setDeleteMenu] = useState(false);
  const deleteMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDeleteMenu(false);
  }, [selected]);

  useEffect(() => {
    applyTheme(initialSettings.theme);
  }, [initialSettings.theme]);

  useEffect(() => {
    if (!deleteMenu) return;
    const onDown = (event: MouseEvent) => {
      if (!deleteMenuRef.current?.contains(event.target as Node)) setDeleteMenu(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDeleteMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [deleteMenu]);

  function openSettings(tab: 'general' | 'generator' | 'supabase' = 'general') {
    setSettingsTab(tab);
    setDraftTheme(settings.theme);
    setDraftSizes(settings.generatorSizes.map(String) as [string, string, string, string]);
    setSettingsError('');
    setPanel('settings');
  }

  function applySettings(next: StudioSettings) {
    saveStudioSettings(next);
    setSettings(next);
    const buttons = sizeButtonList(next.generatorSizes);
    setGenSizes((current) => {
      const kept = current.filter((size) => buttons.includes(size));
      return kept.length > 0 ? kept : [...buttons];
    });
    const nextSingle = buttons.includes(singleSize) ? singleSize : buttons[0] ?? DEFAULT_GENERATOR_SIZES[0];
    setSingleSize(nextSingle);
    if (shapeRaster) {
      try {
        setShapeMatrix(matrixFromRaster(shapeRaster, nextSingle));
        setShapeError('');
      } catch (error) {
        setShapeMatrix(null);
        setShapeError(errorText(error));
      }
    }
  }

  function saveGeneratorSettings() {
    const parsed = draftSizes.map(parseBoardSize);
    if (parsed.some((size) => size == null)) {
      setSettingsError(`Enter four whole numbers from ${MIN_STORED_BOARD_SIZE} to ${MAX_STORED_BOARD_SIZE}.`);
      return;
    }
    const generatorSizes = parsed as [number, number, number, number];
    applySettings({ ...settings, generatorSizes });
    setDraftSizes(generatorSizes.map(String) as [string, string, string, string]);
    setSettingsError('');
    setNotice(`Size buttons set to ${sizeButtonList(generatorSizes).map((n) => `${n}×${n}`).join(', ')}.`);
  }

  function leaveEdit() {
    setEditing(false);
    setDraft(null);
    setSelectedIds([]);
    setDemoPlaying(false);
    setPlayNonce((n) => n + 1);
  }

  function stopDemo() {
    setDemoPlaying(false);
    setDemoToken(0);
    setPlayNonce((n) => n + 1);
  }

  function startDemo() {
    if (!level || editing) return;
    setDemoPlaying(true);
    setDemoToken((n) => n + 1);
  }

  async function refresh(select?: number | null) {
    const [nextStatus, nextRows] = await Promise.all([window.px.status(), window.px.list()]);
    setStatus(nextStatus);
    setRows(nextRows);
    setGenFrom(String(nextStatus.nextLevel));
    const pick = select ?? selected ?? nextRows[0]?.levelNumber ?? null;
    setSelected(pick);
    leaveEdit();
    if (pick != null) setLevel(await window.px.getLevel(pick));
    else setLevel(null);
  }

  useEffect(() => {
    void refresh();
    void window.px.keys().then((keys) => {
      setCloudUrl(keys.url);
      setCloudAnon(keys.anonKey);
      setCloudService(keys.serviceRoleKey);
    });
    void window.px.schema().then(setSchema);
    return window.px.onProgress(setProgress);
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim();
    if (!needle) return rows;
    return rows.filter((row) => String(row.levelNumber).includes(needle) || (row.difficulty ?? '').includes(needle));
  }, [rows, query]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function popupError(message: string) {
    setError(message);
    setShapeError(message);
    setNotice(message);
    window.alert(message);
  }

  async function run(label: string, work: () => Promise<void>): Promise<boolean> {
    setBusy(label);
    setNotice('');
    setError('');
    setStopping('none');
    try {
      await work();
      return true;
    } catch (caught) {
      const message = errorText(caught);
      if (message === 'Generation stopped.' || message === 'Generation stopped after this puzzle.') {
        setNotice(message);
        return false;
      }
      setError(message);
      setShapeError(message);
      setNotice(message);
      window.alert(message);
      return false;
    } finally {
      setBusy('');
      setProgress(null);
      setStopping('none');
    }
  }

  function requestStop(mode: 'now' | 'after') {
    setStopping(mode);
    void window.px.cancelGenerate(mode);
  }

  function generationStopActions() {
    return (
      <>
        <button type="button" onClick={() => requestStop('now')} disabled={stopping === 'now'}>
          {stopping === 'now' ? 'Stopping…' : 'Stop'}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => requestStop('after')}
          disabled={stopping !== 'none'}
        >
          {stopping === 'after' ? 'Finishing this…' : 'Stop after this'}
        </button>
      </>
    );
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    if (shapeFolder && shapeFolderCount === 0 && !alsoUseSquares) {
      popupError('That folder has no images. Add PNG/JPG files, or tick “also use squares”.');
      return;
    }
    if (genSizes.length === 0) {
      popupError('Select at least one size.');
      return;
    }
    const from = Number(genFrom);
    const count = Math.max(1, Number(genCount) || 1);
    setProgress({
      current: 0,
      total: count,
      levelNumber: Number.isFinite(from) ? from : 5,
      arrows: 0,
      fill: 0,
      openings: 0,
      difficulty: 'hard',
    });
    await run('Generating…', async () => {
      const result = await window.px.generate({
        from: Number(genFrom),
        count: Number(genCount),
        quality: genQuality,
        replace: genReplace,
        storedSizes: genSizes,
        shapeFolder: shapeFolder || undefined,
        alsoUseSquares: shapeFolder ? alsoUseSquares : undefined,
      });
      const first = result.generated[0] ?? result.skipped[0] ?? null;
      await refresh(first);
      setPanel('none');
      const skipped = result.skipped.length ? `, skipped ${result.skipped.length}` : '';
      if (result.cancelled) {
        setNotice(
          `Stopped${result.cancelled === 'after' ? ' after this puzzle' : ''}. Wrote ${result.generated.length} level(s)${skipped}.`,
        );
      } else {
        setNotice(`Wrote ${result.generated.length} level(s)${skipped}.`);
      }
    });
  }

  function defaultBoardSize(levelNumber: number): number {
    const choices = sizeChoices.length > 0 ? sizeChoices : [...DEFAULT_GENERATOR_SIZES];
    if (Number.isInteger(levelNumber) && levelNumber >= FIRST_CURATED_LEVEL) {
      try {
        const stored = storedBoardSize(levelNumber);
        if (choices.includes(stored)) return stored;
        return choices.reduce((best, size) =>
          Math.abs(size - stored) < Math.abs(best - stored) ? size : best,
        );
      } catch {
        return choices[0]!;
      }
    }
    return choices[0]!;
  }

  function applyBoardSize(size: number, raster = shapeRaster) {
    if (!isValidBoardSize(size)) return;
    setSingleSize(size);
    if (!raster) {
      setShapeError('');
      return;
    }
    try {
      setShapeMatrix(matrixFromRaster(raster, size));
      setShapeError('');
    } catch (error) {
      setShapeMatrix(null);
      setShapeError(errorText(error));
    }
  }

  async function loadShapeFile(file: File) {
    try {
      const [raster, buffer] = await Promise.all([rasterFromFile(file), file.arrayBuffer()]);
      setShapeRaster(raster);
      setShapeFileName(file.name);
      setShapeFileBytes([...new Uint8Array(buffer)]);
      applyBoardSize(singleSize, raster);
    } catch (error) {
      setShapeRaster(null);
      setShapeMatrix(null);
      setShapeFileName('');
      setShapeFileBytes(null);
      popupError(errorText(error));
    }
  }

  async function onGenerateSingle(event: FormEvent) {
    event.preventDefault();
    const levelNumber = Number(singleLevel);
    if (!Number.isInteger(levelNumber) || levelNumber < 1) {
      popupError('Enter a level number.');
      return;
    }

    let matrix: CellValue[][];
    try {
      matrix = shapeRaster ? matrixFromRaster(shapeRaster, singleSize) : rectangleMatrix(singleSize);
    } catch (caught) {
      popupError(errorText(caught));
      return;
    }
    setShapeMatrix(matrix);

    const attempts = singleQuality === 'fast' ? 8 : singleQuality === 'quality' ? 48 : 24;
    setProgress({
      current: 0,
      total: attempts,
      levelNumber,
      arrows: 0,
      fill: 0,
      openings: 0,
      difficulty: 'hard',
    });
    await run('Generating…', async () => {
      const level = await window.px.generateShaped({
        levelNumber,
        name: singleName.trim() || `Level ${levelNumber}`,
        difficulty: 'hard',
        quality: singleQuality,
        replace: singleReplace,
        matrix,
        shapeSource: shapeRaster ? shapeFileName || 'image' : undefined,
        shapeImage:
          shapeRaster && shapeFileBytes
            ? { fileName: shapeFileName || 'shape.png', bytes: shapeFileBytes }
            : undefined,
      });
      await refresh(Number(level.id));
      setPanel('none');
      setNotice(`Wrote ${singleSize}×${singleSize} level ${level.id}.`);
    });
  }

  async function onRegenerate(event: FormEvent) {
    event.preventDefault();
    const spec = regenSpec.trim();
    if (!spec) {
      popupError('Enter a level range, for example 2-5.');
      return;
    }
    setProgress({
      current: 0,
      total: 1,
      levelNumber: selected ?? 1,
      arrows: 0,
      fill: 0,
      openings: 0,
      difficulty: 'hard',
    });
    await run('Regenerating…', async () => {
      const result = await window.px.regenerate({ spec, quality: regenQuality });
      const first = result.generated[0] ?? selected ?? null;
      await refresh(first);
      setPanel('none');
      const skipped =
        result.skipped.length > 0 ? ` Skipped ${result.skipped.join(', ')}.` : '';
      if (result.cancelled) {
        setNotice(
          `Stopped${result.cancelled === 'after' ? ' after this puzzle' : ''}. Regenerated ${result.generated.length} level(s).${skipped}`,
        );
      } else {
        setNotice(`Regenerated ${result.generated.length} level(s).${skipped}`);
      }
    });
  }

  function selectedSet() {
    return new Set(selectedIds);
  }

  function enterEdit() {
    if (!level) return;
    setShowOpen(false);
    setDeleteMenu(false);
    setDraft(cloneLevel(level));
    setSelectedIds([]);
    setEditing(true);
    setPanel('none');
  }

  function confirmLeaveEdit(): boolean {
    if (editing && draft && level && JSON.stringify(draft.arrows) !== JSON.stringify(level.arrows)) {
      return window.confirm('Discard unsaved edits?');
    }
    return true;
  }

  function toggleEdit() {
    if (editing) {
      if (!confirmLeaveEdit()) return;
      leaveEdit();
      return;
    }
    enterEdit();
  }

  function applyDraft(next: Level, nextIds: string[] = []) {
    setDraft(next);
    setSelectedIds(nextIds);
  }

  function onEditDelete() {
    if (!draft) return;
    applyDraft(deleteArrows(draft, selectedSet()), []);
  }

  function onEditSeparate() {
    if (!draft) return;
    const result = separateArrows(draft, selectedSet());
    applyDraft(result.level, result.selectedIds);
  }

  function onEditMerge() {
    if (!draft) return;
    const result = mergeArrows(draft, selectedSet());
    applyDraft(result.level, result.selectedIds);
  }

  function onEditGenerate() {
    if (!draft) return;
    void run('Generating…', async () => {
      applyDraft(fillLevelVacancies(draft, Date.now()), []);
    });
  }

  async function onEditSave() {
    if (!draft || selected == null) return;
    await run('Saving…', async () => {
      const saved = await window.px.saveLevel(draft);
      setLevel(saved);
      await refresh(selected);
      setNotice(`Saved level ${selected}.`);
    });
  }

  async function onUpload(kind: 'selected' | 'pending') {
    await run('Uploading…', async () => {
      const result =
        kind === 'pending'
          ? await window.px.uploadPending()
          : await window.px.uploadSelected(selected == null ? [] : [selected]);
      if (result.error) throw new Error(result.error);
      await refresh(selected);
      setNotice(`Uploaded ${result.uploaded} level(s).`);
    });
  }

  async function onPull() {
    await run('Pulling…', async () => {
      const result = await window.px.pull();
      if (result.error) throw new Error(result.error);
      await refresh(selected);
      setNotice(`Pulled ${result.pulled} level(s) from Supabase.`);
    });
  }

  async function onDelete(where: 'local' | 'cloud' | 'both') {
    if (selected == null) return;
    const label = `Delete level ${selected} ${where}?`;
    if (!window.confirm(label)) return;
    await run('Deleting…', async () => {
      if (where === 'cloud' || where === 'both') {
        const result = await window.px.deleteCloud([selected]);
        if (result.error) throw new Error(result.error);
      }
      if (where === 'local' || where === 'both') {
        await window.px.deleteLocal([selected]);
      }
      await refresh(null);
      setNotice(`Deleted level ${selected}.`);
    });
  }

  async function onSaveCloud(event: FormEvent) {
    event.preventDefault();
    await run('Saving…', async () => {
      await window.px.saveConfig({
        url: cloudUrl,
        anonKey: cloudAnon,
        serviceRoleKey: cloudService,
      });
      const probed = await window.px.probe();
      setStatus(probed);
      setNotice(
        probed.supabase.tableReady
          ? 'Connected. The levels table is ready.'
          : probed.supabase.error ?? 'Saved. Create the table if the app cannot download yet.',
      );
    });
  }

  async function onAutoSetup() {
    await run('Setting up Supabase…', async () => {
      const result = await window.px.setup();
      setStatus(result.status);
      const keys = await window.px.keys();
      setCloudUrl(keys.url);
      setCloudAnon(keys.anonKey);
      setCloudService(keys.serviceRoleKey);
      setNotice(result.message);
    });
  }

  const generating = busy === 'Generating…' || busy === 'Regenerating…';
  const generatePercent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;
  const cloudLabel = !status
    ? '…'
    : status.supabase.tableReady
      ? 'online'
      : status.supabase.configured
        ? 'keys saved'
        : 'offline';
  const board = editing && draft ? draft : level;
  const separateEnabled = !!draft && canSeparate(draft, selectedIdSet);
  const mergeEnabled = !!draft && canMerge(draft, selectedIdSet);

  return (
    <>
    <div className={`app ${editing ? 'editing' : ''}`}>
      <header className="top">
        <div>
          <h1>PX</h1>
          <p>Campaign studio</p>
        </div>
        <div className={`cloud-pill ${status?.supabase.tableReady ? 'ready' : ''}`}>{cloudLabel}</div>
      </header>

      <aside className="side">
        <div className="side-actions">
          <button className="primary" onClick={() => setPanel('generate')} disabled={!!busy}>
            Generate multiple
          </button>
          <button
            onClick={() => {
              const n = selected ?? status?.nextLevel ?? 5;
              setSingleLevel(String(n));
              applyBoardSize(defaultBoardSize(n));
              setPanel('single');
            }}
            disabled={!!busy}
          >
            Generate single
          </button>
          <button
            onClick={() => {
              setRegenSpec(selected != null ? String(selected) : '2-5');
              setPanel('regenerate');
            }}
            disabled={!!busy}
          >
            Regenerate
          </button>
          <button onClick={() => void onUpload('pending')} disabled={!!busy || !status?.pending}>
            Upload pending
          </button>
          <button onClick={() => void onPull()} disabled={!!busy}>
            Pull from cloud
          </button>
          <button onClick={() => openSettings('supabase')}>Settings</button>
        </div>
        <input
          className="search"
          placeholder="Filter levels"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="list">
          {visible.map((row) => (
            <button
              key={row.levelNumber}
              className={`row ${row.levelNumber === selected ? 'active' : ''}`}
              onClick={() => {
                if (!confirmLeaveEdit()) return;
                leaveEdit();
                setSelected(row.levelNumber);
                void window.px.getLevel(row.levelNumber).then(setLevel);
              }}
            >
              <span className="num">
                {row.levelNumber}
                {row.shaped ? (
                  <span className="shape-mark" title="Generated from an image">
                    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                      <circle cx="5.2" cy="6.2" r="1.25" fill="currentColor" />
                      <path d="M2.8 12.2 6.4 8.4l2.2 2.2 2.4-3.1 2.2 4.7z" fill="currentColor" />
                    </svg>
                  </span>
                ) : null}
              </span>
              <span className="meta">
                {row.difficulty ?? '—'} · {row.arrowCount} · {row.gridSize}×{row.gridSize}
              </span>
              <span className={`dot ${row.uploadedAt ? 'up' : ''}`} title={row.uploadedAt ? 'On Supabase' : 'Local only'} />
            </button>
          ))}
          {visible.length === 0 && <p className="empty">No levels yet.</p>}
        </div>
      </aside>

      <main className="main">
        <div className="main-bar">
          <div>
            {selected == null ? (
              <strong>No level selected</strong>
            ) : (
              <>
                <strong>Level {selected}</strong>
                <span>
                  {board ? `${board.arrows.length} arrows · ${board.grid.rows}×${board.grid.cols}` : ''}
                  {editing ? ' · editing' : ''}
                </span>
              </>
            )}
          </div>
          <div className="main-actions">
            <button
              className={demoPlaying ? 'primary' : undefined}
              onClick={() => (demoPlaying ? stopDemo() : startDemo())}
              disabled={selected == null || !level || !!busy || editing}
            >
              {demoPlaying ? 'Stop' : 'Play'}
            </button>
            <button
              className={showOpen ? 'primary' : undefined}
              onClick={() => setShowOpen((on) => !on)}
              disabled={selected == null || !level || !!busy || editing}
              title="Highlight arrows that can escape right now"
              aria-pressed={showOpen}
            >
              Open
            </button>
            <button
              className={editing ? 'primary' : undefined}
              onClick={toggleEdit}
              disabled={selected == null || !level || !!busy || demoPlaying}
            >
              Edit
            </button>
            <button
              className="icon-btn"
              onClick={() => void onUpload('selected')}
              disabled={selected == null || !!busy || editing || demoPlaying}
              title="Upload this level"
              aria-label="Upload this level"
            >
              <UploadIcon />
            </button>
            <div className="icon-menu" ref={deleteMenuRef}>
              <button
                className="icon-btn"
                onClick={() => setDeleteMenu((open) => !open)}
                disabled={selected == null || !!busy || editing || demoPlaying}
                title="Delete"
                aria-label="Delete"
                aria-haspopup="menu"
                aria-expanded={deleteMenu}
              >
                <BinIcon />
              </button>
              {deleteMenu && (
                <div className="menu" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setDeleteMenu(false);
                      void onDelete('local');
                    }}
                  >
                    Delete local
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setDeleteMenu(false);
                      void onDelete('cloud');
                    }}
                  >
                    Delete online
                  </button>
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setDeleteMenu(false);
                      void onDelete('both');
                    }}
                  >
                    Delete both
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <Playfield
          key={`${selected ?? 'none'}-${editing ? 'edit' : 'play'}-${playNonce}`}
          level={board}
          keysEnabled={panel === 'none' && !editing && !demoPlaying}
          editMode={editing}
          selectedIds={selectedIdSet}
          onSelect={setSelectedIds}
          demoToken={demoToken}
          onDemoFinished={() => setDemoPlaying(false)}
          highlightOpen={showOpen && !editing}
        />
      </main>
      {editing && (
        <aside className="edit-dock">
          <h2>Edit</h2>
          <p>
            {selectedIds.length === 0
              ? 'Click an arrow, or drag a box around several.'
              : `${selectedIds.length} selected`}
          </p>
          <button onClick={onEditDelete} disabled={selectedIds.length === 0}>
            Delete
          </button>
          <button onClick={onEditSeparate} disabled={!separateEnabled}>
            Separate
          </button>
          <button onClick={onEditMerge} disabled={!mergeEnabled}>
            Merge
          </button>
          <button onClick={onEditGenerate} disabled={!draft}>
            Generate
          </button>
          <button className="primary" onClick={() => void onEditSave()} disabled={!draft || !!busy}>
            Save
          </button>
        </aside>
      )}

      <footer className="status">
        <span>{status ? `${status.stored} stored · ${status.pending} pending upload` : 'Loading…'}</span>
        <span>{busy || notice}</span>
        {progress && (
          <span>
            {progress.current}/{progress.total} · level {progress.levelNumber} · {progress.arrows} arrows
          </span>
        )}
      </footer>
    </div>
      {panel === 'generate' && (
        <Modal onClose={() => { if (!generating) setPanel('none'); }}>
        <form className="sheet split" onSubmit={onGenerate}>
          <h2>{generating ? 'Generating…' : 'Generate multiple'}</h2>
          {!generating && error && <p className="form-error" role="alert">{error}</p>}
          {generating ? (
            <div className="gen-progress" aria-live="polite">
              <div className="gen-progress-head">
                <div className="spinner" aria-hidden="true" />
                <div>
                  <strong>{generatePercent}%</strong>
                  <span>
                    {progress && progress.current === 0
                      ? `Starting level ${progress.levelNumber}`
                      : progress
                        ? `Finished ${progress.current} of ${progress.total}`
                        : 'Working'}
                  </span>
                </div>
              </div>
              <div className={`progress-track ${progress && progress.current === 0 ? 'indeterminate' : ''}`}>
                <div className="progress-fill" style={{ width: `${generatePercent}%` }} />
              </div>
              <p>
                {progress?.arrows
                  ? `Level ${progress.levelNumber} · ${progress.arrows} arrows`
                  : 'Hard boards can take a few seconds each. The window is still working.'}
                {stopping === 'after'
                  ? ' Finishing this puzzle, then stopping.'
                  : stopping === 'now'
                    ? ' Stopping as soon as possible…'
                    : ''}
              </p>
            </div>
          ) : (
            <div className="sheet-grid">
              <div className="sheet-col">
          <label>
            From
            <input
              autoFocus
              value={genFrom}
              onChange={(event) => setGenFrom(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </label>
          <label>
            Count
            <input
              value={genCount}
              onChange={(event) => setGenCount(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </label>
          <label>
            Quality
            <select value={genQuality} onChange={(event) => setGenQuality(event.target.value as typeof genQuality)}>
              <option value="fast">Fast (1 seed)</option>
              <option value="normal">Normal (8 seeds)</option>
              <option value="quality">Quality (32 seeds)</option>
            </select>
          </label>
          <div>
            <span className="size-label">Size</span>
            <div className="size-row">
              {sizeChoices.map((size) => {
                const on = genSizes.includes(size);
                return (
                  <button
                    key={size}
                    type="button"
                    className={on ? 'primary' : undefined}
                    aria-pressed={on}
                    onClick={() => {
                      setGenSizes((current) => {
                        if (current.includes(size)) {
                          if (current.length === 1) return current;
                          return current.filter((value) => value !== size);
                        }
                        return [...current, size].sort((a, b) => a - b);
                      });
                    }}
                  >
                    {size}×{size}
                  </button>
                );
              })}
            </div>
            <p>
              {genSizes.length > 1
                ? 'Several selected: each board picks one of these at random.'
                : genSizes[0]
                  ? `Every board will be ${genSizes[0]}×${genSizes[0]}.`
                  : 'Select at least one size.'}
              {' '}
              Change the four presets in Settings → Generator.
            </p>
          </div>
              </div>
              <div className="sheet-col">
          <label className="check">
            <input type="checkbox" checked={genReplace} onChange={(event) => setGenReplace(event.target.checked)} />
            Overwrite if the number already exists
          </label>
          <div className="folder-row">
            <button
              type="button"
              onClick={() => {
                void window.px.pickFolder().then((picked) => {
                  if (!picked) return;
                  setShapeFolder(picked.path);
                  setShapeFolderCount(picked.count);
                });
              }}
            >
              Add folder
            </button>
            {shapeFolder ? (
              <button
                type="button"
                onClick={() => {
                  setShapeFolder('');
                  setShapeFolderCount(0);
                  setAlsoUseSquares(false);
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          {shapeFolder ? (
            <>
              <p className="folder-picked">
                {shapeFolderCount} image{shapeFolderCount === 1 ? '' : 's'} · {shapeFolder}
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={alsoUseSquares}
                  onChange={(event) => setAlsoUseSquares(event.target.checked)}
                />
                Also use squares
              </label>
            </>
          ) : (
            <p>Optional. Pick a folder of silhouettes so boards are not all squares.</p>
          )}
              </div>
            </div>
          )}
          <div className="sheet-actions">
            {generating ? (
              generationStopActions()
            ) : (
              <>
                <button type="button" onClick={() => setPanel('none')}>
                  Cancel
                </button>
                <button className="primary" disabled={!!busy}>
                  Generate
                </button>
              </>
            )}
          </div>
        </form>
        </Modal>
      )}
      {panel === 'single' && (
        <Modal onClose={() => { if (!generating) setPanel('none'); }}>
        <form className="sheet split" onSubmit={onGenerateSingle}>
          <h2>{generating ? 'Generating…' : 'Generate single'}</h2>
          {!generating && (error || shapeError) && (
            <p className="form-error" role="alert">{error || shapeError}</p>
          )}
          {generating ? (
            <div className="gen-progress" aria-live="polite">
              <div className="gen-progress-head">
                <div className="spinner" aria-hidden="true" />
                <div>
                  <strong>{generatePercent}%</strong>
                  <span>
                    {progress && progress.current === 0
                      ? `Starting level ${progress.levelNumber}`
                      : progress
                        ? `Tried ${progress.current} of ${progress.total} seeds`
                        : 'Working'}
                  </span>
                </div>
              </div>
              <div className={`progress-track ${progress && progress.current === 0 ? 'indeterminate' : ''}`}>
                <div className="progress-fill" style={{ width: `${generatePercent}%` }} />
              </div>
              <p>
                {progress?.arrows
                  ? `Best so far: ${progress.arrows} arrows`
                  : 'Packing arrows into the silhouette. The window is still working.'}
                {stopping === 'after'
                  ? ' Finishing this puzzle, then stopping.'
                  : stopping === 'now'
                    ? ' Stopping as soon as possible…'
                    : ''}
              </p>
            </div>
          ) : (
            <div className="sheet-grid">
              <div className="sheet-col">
              <p>
                One board at a time. Optional: drop any colour-on-white silhouette (black, green,
                blue…) and it is pixelated to fit this level.
              </p>
              <label>
                Level
                <input
                  autoFocus
                  value={singleLevel}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSingleLevel(next);
                    const n = Number(next);
                    if (Number.isInteger(n)) applyBoardSize(defaultBoardSize(n));
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </label>
              <label>
                Name
                <input
                  value={singleName}
                  onChange={(event) => setSingleName(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder={`Level ${singleLevel || '…'}`}
                />
              </label>
              <div>
                <span className="size-label">Size</span>
                <div className="size-row">
                  {sizeChoices.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={singleSize === size ? 'primary' : undefined}
                      onClick={() => applyBoardSize(size)}
                    >
                      {size}×{size}
                    </button>
                  ))}
                </div>
                <p className="size-hint">Presets come from Settings → Generator.</p>
              </div>
              <label>
                Quality
                <select
                  value={singleQuality}
                  onChange={(event) => setSingleQuality(event.target.value as typeof singleQuality)}
                >
                  <option value="fast">Fast</option>
                  <option value="normal">Normal</option>
                  <option value="quality">Quality</option>
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={singleReplace}
                  onChange={(event) => setSingleReplace(event.target.checked)}
                />
                Overwrite if the number already exists
              </label>
              </div>
              <div className="sheet-col">
              <label
                className="drop"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) void loadShapeFile(file);
                }}
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void loadShapeFile(file);
                    event.target.value = '';
                  }}
                />
                <span>{shapeFileName || 'Drop a colour-on-white PNG, or click to browse'}</span>
              </label>
              {shapeMatrix && (
                <>
                  <p>
                    Pixelated to {shapeMatrix.length}×{shapeMatrix.length}
                  </p>
                  <SilhouettePreview matrix={shapeMatrix} />
                  <button
                    type="button"
                    onClick={() => {
                      setShapeRaster(null);
                      setShapeMatrix(null);
                      setShapeFileName('');
                      setShapeFileBytes(null);
                      setShapeError('');
                    }}
                  >
                    Remove image
                  </button>
                </>
              )}
              </div>
            </div>
          )}
          <div className="sheet-actions">
            {generating ? (
              generationStopActions()
            ) : (
              <>
                <button type="button" onClick={() => setPanel('none')}>
                  Cancel
                </button>
                <button className="primary" disabled={!!busy}>
                  Generate
                </button>
              </>
            )}
          </div>
        </form>
        </Modal>
      )}
      {panel === 'regenerate' && (
        <Modal onClose={() => { if (!generating) setPanel('none'); }}>
        <form className="sheet" onSubmit={onRegenerate}>
          <h2>{generating ? 'Regenerating…' : 'Regenerate puzzles'}</h2>
          {!generating && error && <p className="form-error" role="alert">{error}</p>}
          {generating ? (
            <div className="gen-progress" aria-live="polite">
              <div className="gen-progress-head">
                <div className="spinner" aria-hidden="true" />
                <div>
                  <strong>{generatePercent}%</strong>
                  <span>
                    {progress
                      ? `Level ${progress.levelNumber} · ${progress.current}/${progress.total}`
                      : 'Working'}
                  </span>
                </div>
              </div>
              <div className={`progress-track ${progress && progress.current === 0 ? 'indeterminate' : ''}`}>
                <div className="progress-fill" style={{ width: `${generatePercent}%` }} />
              </div>
              <p>
                Rebuilding from each level&apos;s saved silhouette. Levels without a stored image are skipped.
                {stopping === 'after'
                  ? ' Finishing this puzzle, then stopping.'
                  : stopping === 'now'
                    ? ' Stopping as soon as possible…'
                    : ''}
              </p>
            </div>
          ) : (
            <>
              <label>
                Levels
                <input
                  autoFocus
                  value={regenSpec}
                  onChange={(event) => setRegenSpec(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder="2-5 or 2 to 5"
                />
              </label>
              <p>
                Uses the same image and board size each level was built with. Works for single-generated image
                boards (and batch image boards once their silhouette was saved).
              </p>
              <label>
                Quality
                <select
                  value={regenQuality}
                  onChange={(event) => setRegenQuality(event.target.value as typeof regenQuality)}
                >
                  <option value="fast">Fast</option>
                  <option value="normal">Normal</option>
                  <option value="quality">Quality</option>
                </select>
              </label>
            </>
          )}
          <div className="sheet-actions">
            {generating ? (
              generationStopActions()
            ) : (
              <>
                <button type="button" onClick={() => setPanel('none')}>
                  Cancel
                </button>
                <button className="primary" disabled={!!busy}>
                  Regenerate
                </button>
              </>
            )}
          </div>
        </form>
        </Modal>
      )}
      {panel === 'settings' && (
        <Modal onClose={() => setPanel('none')}>
          <div className="sheet wide settings-sheet">
            <h2>Settings</h2>
            <div className="settings-tabs" role="tablist" aria-label="Settings sections">
              {(
                [
                  ['general', 'General'],
                  ['generator', 'Generator'],
                  ['supabase', 'Supabase'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === id}
                  className={settingsTab === id ? 'primary' : undefined}
                  onClick={() => {
                    setSettingsTab(id);
                    setSettingsError('');
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {settingsTab === 'general' && (
              <div className="settings-pane" role="tabpanel">
                <p>Appearance for this PX window on this computer.</p>
                <fieldset className="theme-field">
                  <legend>Theme</legend>
                  <label className="check">
                    <input
                      type="radio"
                      name="px-theme"
                      checked={draftTheme === 'light'}
                      onChange={() => {
                        setDraftTheme('light');
                        applySettings({ ...settings, theme: 'light' });
                      }}
                    />
                    Light
                  </label>
                  <label className="check">
                    <input
                      type="radio"
                      name="px-theme"
                      checked={draftTheme === 'dark'}
                      onChange={() => {
                        setDraftTheme('dark');
                        applySettings({ ...settings, theme: 'dark' });
                      }}
                    />
                    Dark
                  </label>
                </fieldset>
                <div className="sheet-actions">
                  <button type="button" onClick={() => setPanel('none')}>
                    Close
                  </button>
                </div>
              </div>
            )}

            {settingsTab === 'generator' && (
              <div className="settings-pane" role="tabpanel">
                <p>
                  These four values become the size buttons in Generate multiple and Generate single.
                  Allowed range: {MIN_STORED_BOARD_SIZE}–{MAX_STORED_BOARD_SIZE}.
                </p>
                {settingsError && (
                  <p className="form-error" role="alert">
                    {settingsError}
                  </p>
                )}
                <div className="sheet-grid">
                  {([0, 1, 2, 3] as const).map((index) => (
                    <label key={index}>
                      Size {index + 1}
                      <input
                        value={draftSizes[index]}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraftSizes((current) => {
                            const next = [...current] as [string, string, string, string];
                            next[index] = value;
                            return next;
                          });
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        inputMode="numeric"
                        placeholder={String(DEFAULT_GENERATOR_SIZES[index])}
                      />
                    </label>
                  ))}
                </div>
                <div className="sheet-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftSizes(DEFAULT_GENERATOR_SIZES.map(String) as [string, string, string, string]);
                      setSettingsError('');
                    }}
                  >
                    Reset defaults
                  </button>
                  <button type="button" onClick={() => setPanel('none')}>
                    Close
                  </button>
                  <button type="button" className="primary" onClick={saveGeneratorSettings}>
                    Save
                  </button>
                </div>
              </div>
            )}

            {settingsTab === 'supabase' && (
              <form className="settings-pane" role="tabpanel" onSubmit={onSaveCloud}>
                <p>
                  PX writes the campaign here. The phone app only reads it. Paste keys from Project Settings → API, or try
                  automatic setup if this machine is logged into the Supabase CLI.
                </p>
                <button type="button" onClick={() => void onAutoSetup()} disabled={!!busy}>
                  Set up for me
                </button>
                <label>
                  Project URL
                  <input
                    value={cloudUrl}
                    onChange={(event) => setCloudUrl(event.target.value)}
                    placeholder="https://xxxx.supabase.co"
                  />
                </label>
                <label>
                  Anon key (safe for the app)
                  <textarea value={cloudAnon} onChange={(event) => setCloudAnon(event.target.value)} rows={3} />
                </label>
                <label>
                  Service role key (this PC only)
                  <textarea value={cloudService} onChange={(event) => setCloudService(event.target.value)} rows={3} />
                </label>
                <details>
                  <summary>SQL to run if the table is missing</summary>
                  <pre>{schema}</pre>
                </details>
                <div className="sheet-actions">
                  <button type="button" onClick={() => setPanel('none')}>
                    Close
                  </button>
                  <button className="primary" disabled={!!busy}>
                    Save keys
                  </button>
                </div>
              </form>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function SilhouettePreview({ matrix }: { matrix: CellValue[][] }) {
  const size = matrix.length;
  return (
    <div
      className="silhouette"
      style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      aria-label={`${size} by ${size} silhouette preview`}
    >
      {matrix.flatMap((row, r) =>
        row.map((cell, c) => (
          <span key={`${r}-${c}`} className={cell === CELL_FLOOR ? 'ink' : 'paper'} />
        )),
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 2.2 12.4 6.6h-2.5V11H6.1V6.6H3.6L8 2.2zm-5 10.3h10v1.5H3v-1.5z"
      />
    </svg>
  );
}

function BinIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.1 2h3.8l.4 1.2H14v1.3H2V3.2h3.7L6.1 2zM3.4 5.8h9.2l-.6 8.1a1.1 1.1 0 0 1-1.1 1H5.1a1.1 1.1 0 0 1-1.1-1l-.6-8.1zm2.4 1.4v5.4h1.2V7.2H5.8zm2.4 0v5.4h1.2V7.2H8.2zm2.4 0v5.4h1.2V7.2h-1.2z"
      />
    </svg>
  );
}

function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        event.stopPropagation();
      }}
    >
      <div className="sheet-wrap" onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
