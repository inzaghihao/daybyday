/** Shared state, persistence and domain helpers for the DAY BY DAY routes. */
import { reactive, ref, shallowRef } from 'vue'
import { imageDisplayUrl } from '../services/images'
export const core = (() => {
/* ======================================================================
     1. 常量
     ====================================================================== */
  const STORAGE_KEY = 'daybyday';

  /* 打卡照片单独存：优先 IndexedDB（容量大），不支持时退回 localStorage */
  const PHOTO_DB = 'daybyday-photos';
  const PHOTO_FALLBACK_KEY = 'daybyday-photos';
  const PHOTO_MAX_EDGE = 1024;
  const PHOTO_QUALITY = .62;

  /* 图标底色：暗色主题下用低饱和的深色块，靠明度差把 emoji 托起来 */
  const COLORS = ['#3c5340', '#584634', '#354a5e', '#493f5c', '#5a5333', '#32544b'];

  const ICONS = ['💧', '📖', '🏃', '✍️', '🧘', '🌱', '🎨', '🛏️', '🥗', '☀️', '🎧', '🧹'];

  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  /**
   * 只留一个示例打卡项：其余习惯都要用户自己新建，
   * 避免一上来就被塞一堆不属于自己的目标。
   */
  const DEFAULT_HABITS = [
    { id: 'water', name: '喝一杯水', detail: '示例打卡项，可改可删', icon: '💧', color: 0, needPhoto: false },
  ];

  /**
   * 旧版本预置过的示例习惯。只有「名字没改过、也从没打过卡」的才会被收掉，
   * 用户自己改过或用过的实例一律保留。
   */
  const LEGACY_SAMPLES = {
    read: '阅读 20 分钟',
    move: '运动一下',
    journal: '写下今日心情',
  };

  const DAY_MS = 864e5;
  const STREAK_SCAN_DAYS = 3650;
  const MAX_CYCLE_DAYS = 3650;

  /* ======================================================================
     2. 小工具
     ====================================================================== */
  const $ = id => document.getElementById(id);

  const pad2 = n => String(n).padStart(2, '0');

  /** 本地日期键 YYYY-MM-DD（刻意不用 toISOString，避免 UTC 偏移导致跨天错位） */
  const dateKey = (d = new Date()) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  /** 把 YYYY-MM-DD 解析成「本地零点」，与 dateKey 的口径保持一致 */
  const parseKey = key => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const shiftDays = (d, n) => {
    const next = new Date(d);
    next.setDate(next.getDate() + n);
    return next;
  };

  const today = () => dateKey();
  const monthOf = (key = today()) => key.slice(0, 7);

  /** 是否是合法的 YYYY-MM-DD 字符串 */
  const isDateKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  /** 两个日期键之间的天数差（含首尾时为 +1） */
  const daysBetween = (from, to) => Math.round((parseKey(to) - parseKey(from)) / DAY_MS);

  /** 今天还没过完，能记录的最晚一天是昨天 */
  const yesterdayKey = () => dateKey(shiftDays(new Date(), -1));

  const fmtDate = key => {
    const d = parseKey(key);
    return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
  };

  const shortDate = key => {
    const d = parseKey(key);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const clampInt = (value, fallback, min, max) => {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  /* ======================================================================
     3. 状态
     ====================================================================== */
  const data = reactive(loadState());
  let journalOnline = false;

  /** 当前正在记录/回看的那一天，默认昨天；旅程第一天时为空 */
  const viewDate = ref(null);

  const modal = shallowRef(null);
  const revision = ref(0);

  /**
   * 周期不预设默认范围：第一次必须由用户自己选开始和结束。
   * 未设置时 start / end 都是 null，界面走「待设置」分支。
   */
  function defaultState() {
    return {
      name: '新朋友',
      avatar: '',
      start: null,
      end: null,
      restLimit: 2,
      rests: {},      // { '2026-11': 已用小憩次数 }
      restDays: {},   // { '2026-11-04': 1 } 具体哪几天休息过
      habits: DEFAULT_HABITS.map(h => ({ ...h })),
      records: {},    // { '2026-11-04': ['water'] }
      checkins: {},   // { '2026-11-04': 1 } 这天打过卡（可能一项都没完成）
      reminder: { enabled: false, time: '21:00' },   // 打卡提醒（本地时间）
    };
  }

  function loadState() {
    return defaultState();
  }

  /** 把初始状态收敛成合法结构 */
  function normalize() {
    const before = JSON.stringify(data);
    data.restLimit = clampInt(data.restLimit, 2, 0, 99);
    data.name = typeof data.name === 'string' ? data.name : '新朋友';
    data.avatar = typeof data.avatar === 'string' && /^data:image\//.test(data.avatar) ? data.avatar : '';

    // 周期：第一次由用户手动设置；只有旧版本存档（只存 start + goalDays）才自动补出结束日
    if (isDateKey(data.start) && isDateKey(data.end)) {
      if (data.end < data.start) data.end = data.start;

      const latestEnd = dateKey(shiftDays(parseKey(data.start), MAX_CYCLE_DAYS - 1));
      if (data.end > latestEnd) data.end = latestEnd;
    } else if (isDateKey(data.start) && Number(data.goalDays) >= 1) {
      const legacyDays = clampInt(data.goalDays, 100, 1, MAX_CYCLE_DAYS);
      data.end = dateKey(shiftDays(parseKey(data.start), legacyDays - 1));
    } else {
      // 没有可用的起止日期：保持「未设置」，等用户自己选
      data.start = null;
      data.end = null;
    }
    delete data.goalDays;
    data.habits = Array.isArray(data.habits)
      ? data.habits.filter(h => h && h.id && h.name).map(h => ({
          id: String(h.id),
          name: String(h.name),
          detail: typeof h.detail === 'string' ? h.detail : '',
          icon: typeof h.icon === 'string' && h.icon ? h.icon : ICONS[0],
          color: clampInt(h.color, 0, 0, COLORS.length - 1),
          needPhoto: h.needPhoto === true,
        }))
      : [];
    data.records = isPlainObject(data.records) ? data.records : {};
    data.checkins = isPlainObject(data.checkins) ? data.checkins : {};
    data.rests = isPlainObject(data.rests) ? data.rests : {};
    data.restDays = isPlainObject(data.restDays) ? data.restDays : {};

    // 提醒设置：时间必须是 HH:MM，坏值一律回落到 21:00
    const rm = isPlainObject(data.reminder) ? data.reminder : {};
    data.reminder = {
      enabled: rm.enabled === true,
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(rm.time || '') ? rm.time : '21:00',
    };
    rebuildRests();

    // 老存档只有 records：有完成项就视为这天打过卡
    Object.keys(data.records).forEach(key => {
      if (isDateKey(key) && Array.isArray(data.records[key]) && data.records[key].length) {
        data.checkins[key] = 1;
      }
    });
    Object.keys(data.checkins).forEach(key => {
      if (!isDateKey(key) || !data.checkins[key]) delete data.checkins[key];
    });

    // 习惯设置来自线上，初始化时不能用默认习惯删除本机打卡记录。
    Object.keys(data.records).forEach(key => {
      const list = Array.isArray(data.records[key]) ? data.records[key].filter(id => typeof id === 'string') : [];
      if (list.length) data.records[key] = list;
      else delete data.records[key];
    });

    // 旧版预置的示例习惯只留「喝一杯水」：改过名或打过卡的一律保留
    if (data.habits.some(h => h.id === 'water')) {
      const usedIds = new Set(Object.values(data.records).flat());
      data.habits = data.habits.filter(h => (
        !LEGACY_SAMPLES[h.id] || h.name !== LEGACY_SAMPLES[h.id] || usedIds.has(h.id)
      ));
    }

    // 迁移过（比如补出了 end）就立刻落盘，避免每次启动重算
    if (JSON.stringify(data) !== before) persist();
  }

  const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

  function persist() {
    if (journalOnline) actions.syncJournal?.();
  }

  function setJournalOnline() {
    journalOnline = true;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(PHOTO_FALLBACK_KEY); } catch {}
    try { indexedDB.deleteDatabase(PHOTO_DB); } catch {}
  }

  function resetJournal() {
    journalOnline = false;
    data.records = {};
    data.checkins = {};
    data.restDays = {};
    data.rests = {};
    photos.value = {};
    refreshAll();
  }

  /** 每月小憩次数直接由 restDays 重算，避免计数漂移 */
  function rebuildRests() {
    const counts = {};
    Object.keys(data.restDays).forEach(key => {
      const month = key.slice(0, 7);
      counts[month] = (counts[month] || 0) + 1;
    });
    data.rests = counts;
  }

  /* ---- 打卡照片只在内存中展示，线上记录是唯一数据源 ---- */
  /** 照片键形如 '2026-11-04|habitId' */
  const photoKey = (key, habitId) => `${key}|${habitId}`;

  const photos = ref({});
  let photoReady = false;

  const photoOf = (key, habitId) => (key ? imageDisplayUrl(photos.value[photoKey(key, habitId)] || '') : '');

  async function initPhotos() {
    photoReady = true;
  }

  function putPhoto(id, value) {
    photos.value[id] = value;
  }

  function dropPhoto(id) {
    if (!Object.prototype.hasOwnProperty.call(photos.value, id)) return;
    delete photos.value[id];
  }

  function dropPhotosBy(predicate) {
    Object.keys(photos.value).filter(predicate).forEach(dropPhoto);
  }

  /** 清掉日期非法、习惯已删、内容不是图片的脏数据 */
  function prunePhotos() {
    const ids = new Set(data.habits.map(h => h.id));
    Object.keys(photos.value).forEach(id => {
      const [key, habitId] = id.split('|');
      if (!isDateKey(key) || !ids.has(habitId) || !(/^(data:image\/|\/images\/)/.test(String(photos.value[id])))) {
        dropPhoto(id);
      }
    });
  }

  function replacePhotos(map) {
    photos.value = {};
    Object.keys(map || {}).forEach(id => {
      const value = map[id];
      if (typeof value === 'string' && /^(data:image\/|\/images\/)/.test(value)) putPhoto(id, value);
    });
    prunePhotos();
  }

  /* ======================================================================
     4. 派生计算
     ====================================================================== */
  const recordsOf = key => data.records[key] || [];
  const hasRecord = key => recordsOf(key).length > 0;

  /**
   * 这天是否打过卡。
   * 打卡是独立动作：一项都没勾也可以打卡，只是记为「未完成」。
   * records 里有内容的老数据同样视为已打卡。
   */
  const isCheckedIn = key => !!key && (!!data.checkins[key] || hasRecord(key));

  /** 这天是否把所有打卡项都做完了 */
  const isDayComplete = key => data.habits.length > 0 && recordsOf(key).length >= data.habits.length;

  const isRestDay = key => !!data.restDays[key];
  const isRested = key => !!key && isRestDay(key);

  /** 是否已经设置过目标周期；没设置时首页与统计都走「待设置」分支 */
  const hasCycle = () => isDateKey(data.start) && isDateKey(data.end);

  /** 周期总天数，由起止日期算出（含首尾） */
  const journeyDays = () => (hasCycle() ? daysBetween(data.start, data.end) + 1 : 0);

  /** 能记录、能结算的最后一天：昨天与周期终点取较早者 */
  const lastSettleableKey = () => (hasCycle()
    ? (yesterdayKey() < data.end ? yesterdayKey() : data.end)
    : null);

  /** 打过卡的日期集合（records 里有内容也算，兼容没写 checkins 的老数据） */
  function checkedKeys() {
    const keys = new Set(Object.keys(data.checkins).filter(key => data.checkins[key]));
    Object.keys(data.records).forEach(key => {
      if (Array.isArray(data.records[key]) && data.records[key].length) keys.add(key);
    });
    return [...keys];
  }

  /** 本周期内已打卡的天数（含一项都没完成的那种） */
  function cycleRecordDays() {
    if (!hasCycle()) return 0;
    return checkedKeys().filter(key => key >= data.start && key <= data.end).length;
  }

  /** 本周期内用掉的小憩天数 */
  function cycleRestDays() {
    if (!hasCycle()) return 0;
    return Object.keys(data.restDays).filter(
      key => key >= data.start && key <= data.end,
    ).length;
  }

  /** 周期所处阶段：未设置 / 未开始 / 进行中 / 已结束 */
  function cyclePhase() {
    if (!hasCycle()) return 'unset';
    const key = today();
    if (key < data.start) return 'pending';
    if (key > data.end) return 'ended';
    return 'running';
  }

  /**
   * 周期一旦开始就不再允许直接调整，只能走「重新设置」。
   * 唯一例外是设置当天（start === 今天且还没有任何记录），
   * 留一个纠正口子，否则新用户手滑就再也改不回来。
   */
  const isCycleLocked = () => (hasCycle() && (today() > data.start || cycleRecordDays() > 0));

  /** 旅程第几天，夹在 [1, 周期天数] */
  function dayNum() {
    if (!hasCycle()) return 0;
    const diff = daysBetween(data.start, today()) + 1;
    return clampInt(diff, 1, 1, journeyDays());
  }

  /** 已彻底过去、可以结算的天数（今天还没结束，且不超过周期终点） */
  function settledDays() {
    if (!hasCycle()) return 0;
    const last = lastSettleableKey();
    if (!last || last < data.start) return 0;
    return daysBetween(data.start, last) + 1;
  }

  /** 小憩额度按「正在记录的那一天」所在的自然月计算 */
  const restUsed = (key = viewDate.value) => (key ? Number(data.rests[monthOf(key)]) || 0 : 0);
  const restLeft = (key = viewDate.value) => Math.max(0, data.restLimit - restUsed(key));

  /** 记录日的合法区间：[周期起点, 可结算的最后一天]，默认停在最后一天 */
  function ensureViewDate() {
    const latest = lastSettleableKey();
    if (!latest || latest < data.start) { viewDate.value = null; return; }

    if (!isDateKey(viewDate.value) || viewDate.value < data.start || viewDate.value > latest) viewDate.value = latest;
  }

  /**
   * 连续打卡：从昨天往前数（今天还没结束，不参与计算）。
   * - 已打卡（哪怕一项都没完成）→ +1
   * - 昨天还没打卡 → 不算断（可能只是还没结算）
   * - 小憩日 → 不算断，但也不 +1
   */
  function streakDays() {
    if (!hasCycle()) return 0;

    let streak = 0;
    let cursor = shiftDays(new Date(), -1);

    for (let i = 0; i < STREAK_SCAN_DAYS; i++) {
      const key = dateKey(cursor);
      if (key < data.start) break;

      if (isCheckedIn(key)) streak++;
      else if (!isRestDay(key) && i > 0) break;

      cursor = shiftDays(cursor, -1);
    }
    return streak;
  }

  function totalChecks() {
    return Object.values(data.records).reduce((sum, list) => sum + list.length, 0);
  }

  /** 只统计落在本周期内的次数，用于完成率（周期外的历史不算分子也不算分母） */
  function checksInCycle() {
    if (!hasCycle()) return 0;
    return Object.entries(data.records).reduce((sum, [key, list]) => (
      key >= data.start && key <= data.end ? sum + list.length : sum
    ), 0);
  }

  /** 每个习惯的累计次数，按次数降序 */
  function habitCounts() {
    const counter = new Map(data.habits.map(h => [h.id, 0]));
    Object.values(data.records).forEach(list => {
      list.forEach(id => {
        if (counter.has(id)) counter.set(id, counter.get(id) + 1);
      });
    });
    return data.habits
      .map(h => [h, counter.get(h.id)])
      .sort((a, b) => b[1] - a[1]);
  }


  const actions = {};
  let initialized = false;

  function refreshAll() {
    revision.value++;
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    normalize();
    ensureViewDate();
    void initPhotos();
  }

  function openModal(content) {
    modal.value = content;
  }

  function closeModal() {
    modal.value = null;
  }

  function confirmAction(title, desc, onConfirm, confirmText = '确定') {
    openModal({ kind: 'confirm', title, desc, onConfirm, confirmText });
  }

  function confirmModal() {
    const content = modal.value;
    if (content?.kind !== 'confirm') return;
    closeModal();
    content.onConfirm();
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }


  return {
    STORAGE_KEY, PHOTO_MAX_EDGE, PHOTO_QUALITY, MAX_CYCLE_DAYS, COLORS, ICONS, WEEK, $, pad2, dateKey, parseKey, shiftDays,
    today, monthOf, isDateKey, daysBetween, yesterdayKey, fmtDate, shortDate,
    clampInt,
    get data() { return data; },
    get viewDate() { return viewDate.value; },
    set viewDate(value) { viewDate.value = value; },
    modal, revision,
    get photos() { return photos.value; },
    get photoReady() { return photoReady; },
    defaultState, persist, setJournalOnline, resetJournal, rebuildRests, photoKey,
    photoOf, initPhotos, putPhoto, dropPhoto, dropPhotosBy, prunePhotos,
    replacePhotos, recordsOf, hasRecord, isCheckedIn, isDayComplete,
    isRestDay, isRested, hasCycle, journeyDays, lastSettleableKey,
    checkedKeys, cycleRecordDays, cycleRestDays, cyclePhase, isCycleLocked,
    dayNum, settledDays, restUsed, restLeft, ensureViewDate, streakDays,
    totalChecks, checksInCycle, habitCounts, actions,
    refreshAll, initialize, openModal,
    closeModal, confirmModal, confirmAction, toast,
  };
})();
