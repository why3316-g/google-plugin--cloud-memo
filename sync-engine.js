// 云备忘录同步引擎：只包含浏览器 popup 和 service worker 共用的纯数据逻辑。
(function (global) {
  'use strict';

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function asTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  }

  function normalizeNote(note) {
    if (!note || note.id === undefined || note.id === null) return null;
    return {
      id: note.id,
      title: typeof note.title === 'string' ? note.title : '',
      content: typeof note.content === 'string' ? note.content : '',
      createdAt: asTimestamp(note.createdAt) || asTimestamp(note.updatedAt) || Date.now(),
      updatedAt: asTimestamp(note.updatedAt) || asTimestamp(note.createdAt) || Date.now()
    };
  }

  function normalizeNotes(notes) {
    if (!Array.isArray(notes)) return [];
    return notes.map(normalizeNote).filter(Boolean);
  }

  function normalizeDeletedNotes(deletedNotes) {
    const result = {};
    if (Array.isArray(deletedNotes)) {
      deletedNotes.forEach((item) => {
        if (item && item.id !== undefined) result[String(item.id)] = asTimestamp(item.deletedAt) || Date.now();
      });
    } else if (deletedNotes && typeof deletedNotes === 'object') {
      Object.entries(deletedNotes).forEach(([id, timestamp]) => {
        const value = asTimestamp(timestamp);
        if (value) result[id] = value;
      });
    }
    return result;
  }

  function noteKey(noteOrId) {
    return String(typeof noteOrId === 'object' ? noteOrId.id : noteOrId);
  }

  function sameText(left, right) {
    return (left || '') === (right || '');
  }

  function sameNoteContent(left, right) {
    return Boolean(left && right) && sameText(left.title, right.title) && sameText(left.content, right.content);
  }

  function splitParagraphs(text) {
    return String(text || '').split(/\n{2,}/);
  }

  // 按字符找出一端相对共同版本的多个修改区间。
  // 超长段落使用保守的单区间策略，避免同步时占用过多内存。
  function getChanges(base, revised) {
    if (base === revised) return [];
    if (base.length > 2500 || revised.length > 2500) {
      let start = 0;
      while (start < base.length && start < revised.length && base[start] === revised[start]) start += 1;
      let baseEnd = base.length;
      let revisedEnd = revised.length;
      while (baseEnd > start && revisedEnd > start && base[baseEnd - 1] === revised[revisedEnd - 1]) {
        baseEnd -= 1;
        revisedEnd -= 1;
      }
      return [{ start, end: baseEnd, replacement: revised.slice(start, revisedEnd) }];
    }

    const rows = base.length + 1;
    const columns = revised.length + 1;
    const lcs = Array.from({ length: rows }, () => new Uint16Array(columns));
    for (let row = base.length - 1; row >= 0; row -= 1) {
      for (let column = revised.length - 1; column >= 0; column -= 1) {
        lcs[row][column] = base[row] === revised[column]
          ? lcs[row + 1][column + 1] + 1
          : Math.max(lcs[row + 1][column], lcs[row][column + 1]);
      }
    }

    const changes = [];
    let baseIndex = 0;
    let revisedIndex = 0;
    let pending = null;
    const finishPending = () => {
      if (pending) {
        changes.push({
          start: pending.start,
          end: baseIndex,
          replacement: revised.slice(pending.revisedStart, revisedIndex)
        });
        pending = null;
      }
    };

    while (baseIndex < base.length || revisedIndex < revised.length) {
      if (baseIndex < base.length && revisedIndex < revised.length && base[baseIndex] === revised[revisedIndex]) {
        finishPending();
        baseIndex += 1;
        revisedIndex += 1;
      } else if (
        revisedIndex >= revised.length ||
        (baseIndex < base.length && lcs[baseIndex + 1][revisedIndex] >= lcs[baseIndex][revisedIndex + 1])
      ) {
        if (!pending) pending = { start: baseIndex, revisedStart: revisedIndex };
        baseIndex += 1;
      } else {
        if (!pending) pending = { start: baseIndex, revisedStart: revisedIndex };
        revisedIndex += 1;
      }
    }
    finishPending();
    return changes;
  }

  function changesOverlap(left, right) {
    if (left.start === left.end && right.start === right.end) return left.start === right.start;
    if (left.start === left.end) return left.start > right.start && left.start < right.end;
    if (right.start === right.end) return right.start > left.start && right.start < left.end;
    return left.start < right.end && right.start < left.end;
  }

  function applyChanges(base, changes) {
    return changes
      .slice()
      .sort((a, b) => b.start - a.start)
      .reduce((result, change) => result.slice(0, change.start) + change.replacement + result.slice(change.end), base);
  }

  function mergeParagraph(base, local, cloud, localAt, cloudAt) {
    if (local === cloud) return { text: local, conflict: false };
    if (local === base) return { text: cloud, conflict: false };
    if (cloud === base) return { text: local, conflict: false };

    const localChanges = getChanges(base, local);
    const cloudChanges = getChanges(base, cloud);
    const overlaps = localChanges.some((localChange) =>
      cloudChanges.some((cloudChange) => changesOverlap(localChange, cloudChange))
    );
    if (localChanges.length > 0 && cloudChanges.length > 0 && !overlaps) {
      return { text: applyChanges(base, [...localChanges, ...cloudChanges]), conflict: false };
    }

    // 同一字符区间被两端同时修改，无法无损猜测语义，按最新修改时间处理。
    return {
      text: cloudAt > localAt ? cloud : local,
      conflict: true
    };
  }

  function mergeText(base, local, cloud, localAt, cloudAt) {
    if (local === cloud) return { text: local, conflictCount: 0 };
    if (local === base) return { text: cloud, conflictCount: 0 };
    if (cloud === base) return { text: local, conflictCount: 0 };
    if (base === undefined || base === null) {
      return { text: cloudAt > localAt ? cloud : local, conflictCount: 1 };
    }

    const baseParagraphs = splitParagraphs(base);
    const localParagraphs = splitParagraphs(local);
    const cloudParagraphs = splitParagraphs(cloud);

    // 段落数量变化时，优先保留最新版本，避免错误地把后续段落错位合并。
    if (baseParagraphs.length !== localParagraphs.length || baseParagraphs.length !== cloudParagraphs.length) {
      return { text: cloudAt > localAt ? cloud : local, conflictCount: 1 };
    }

    const merged = [];
    let conflictCount = 0;
    for (let index = 0; index < baseParagraphs.length; index += 1) {
      const paragraph = mergeParagraph(
        baseParagraphs[index],
        localParagraphs[index],
        cloudParagraphs[index],
        localAt,
        cloudAt
      );
      merged.push(paragraph.text);
      if (paragraph.conflict) conflictCount += 1;
    }

    return { text: merged.join('\n\n'), conflictCount };
  }

  function chooseField(baseValue, localValue, cloudValue, localAt, cloudAt) {
    if (localValue === cloudValue) return { value: localValue, conflict: false };
    if (baseValue !== undefined && localValue === baseValue) return { value: cloudValue, conflict: false };
    if (baseValue !== undefined && cloudValue === baseValue) return { value: localValue, conflict: false };
    return { value: cloudAt > localAt ? cloudValue : localValue, conflict: true };
  }

  function mergeNote(local, cloud, base) {
    const localAt = asTimestamp(local && local.updatedAt);
    const cloudAt = asTimestamp(cloud && cloud.updatedAt);
    if (!local) return { note: clone(cloud), conflictCount: 0 };
    if (!cloud) return { note: clone(local), conflictCount: 0 };
    if (sameNoteContent(local, cloud)) {
      return { note: { ...clone(local), updatedAt: Math.max(localAt, cloudAt) }, conflictCount: 0 };
    }

    if (!base) {
      return {
        note: clone(cloudAt > localAt ? cloud : local),
        conflictCount: 1
      };
    }

    const title = chooseField(base.title, local.title, cloud.title, localAt, cloudAt);
    const content = mergeText(base.content, local.content, cloud.content, localAt, cloudAt);
    return {
      note: {
        id: local.id,
        title: title.value,
        content: content.text,
        createdAt: Math.min(asTimestamp(local.createdAt) || localAt, asTimestamp(cloud.createdAt) || cloudAt),
        updatedAt: Math.max(localAt, cloudAt)
      },
      conflictCount: (title.conflict ? 1 : 0) + content.conflictCount
    };
  }

  function mergeNoteSets(localNotes, cloudNotes, baseNotes, localDeleted, cloudDeleted, localOrder, cloudOrder) {
    const local = normalizeNotes(localNotes);
    const cloud = normalizeNotes(cloudNotes);
    const base = normalizeNotes(baseNotes);
    const localTombstones = normalizeDeletedNotes(localDeleted);
    const cloudTombstones = normalizeDeletedNotes(cloudDeleted);
    const localMap = new Map(local.map((note) => [noteKey(note), note]));
    const cloudMap = new Map(cloud.map((note) => [noteKey(note), note]));
    const baseMap = new Map(base.map((note) => [noteKey(note), note]));
    const ids = new Set([
      ...localMap.keys(),
      ...cloudMap.keys(),
      ...Object.keys(localTombstones),
      ...Object.keys(cloudTombstones)
    ]);
    const mergedMap = new Map();
    const mergedDeleted = {};
    let conflictCount = 0;
    let changedCount = 0;

    ids.forEach((id) => {
      const localNote = localMap.get(id);
      const cloudNote = cloudMap.get(id);
      const localDeletedAt = localTombstones[id] || 0;
      const cloudDeletedAt = cloudTombstones[id] || 0;
      const latestDeletion = Math.max(localDeletedAt, cloudDeletedAt);
      const latestNoteAt = Math.max(asTimestamp(localNote && localNote.updatedAt), asTimestamp(cloudNote && cloudNote.updatedAt));

      if (latestDeletion > latestNoteAt) {
        mergedDeleted[id] = latestDeletion;
        return;
      }

      if (localNote || cloudNote) {
        const mergedNoteResult = mergeNote(localNote, cloudNote, baseMap.get(id));
        mergedMap.set(id, mergedNoteResult.note);
        conflictCount += mergedNoteResult.conflictCount;
        if (localNote && cloudNote && !sameNoteContent(localNote, cloudNote)) changedCount += 1;
      }
    });

    const noteOrder = [];
    const orderIds = [
      ...(Array.isArray(localOrder) ? localOrder : []),
      ...(Array.isArray(cloudOrder) ? cloudOrder : [])
    ].map(String);
    orderIds.forEach((id) => {
      if (mergedMap.has(id) && !noteOrder.includes(id)) noteOrder.push(id);
    });
    Array.from(mergedMap.values())
      .sort((a, b) => asTimestamp(b.updatedAt) - asTimestamp(a.updatedAt))
      .forEach((note) => {
        const id = noteKey(note);
        if (!noteOrder.includes(id)) noteOrder.push(id);
      });

    const merged = noteOrder.map((id) => mergedMap.get(id)).filter(Boolean);
    return {
      merged,
      noteOrder,
      deletedNotes: mergedDeleted,
      localCount: local.length,
      cloudCount: cloud.length,
      mergedCount: merged.length,
      changedCount,
      conflictCount
    };
  }

  function createEnvelope(notes, noteOrder, deletedNotes, device) {
    return {
      schemaVersion: 2,
      notes: normalizeNotes(notes),
      noteOrder: Array.isArray(noteOrder) ? noteOrder : normalizeNotes(notes).map((note) => note.id),
      deletedNotes: normalizeDeletedNotes(deletedNotes),
      syncTime: Date.now(),
      device: device || 'Chrome Extension'
    };
  }

  global.MemoSync = {
    normalizeNotes,
    normalizeDeletedNotes,
    sameNoteContent,
    mergeNoteSets,
    createEnvelope
  };
})(globalThis);
