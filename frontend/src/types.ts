export type RevisionKind = "recorded" | "teaching";

export type PresentationMode = "video_lecture" | "slide_only" | "external_link_only";

export interface CueInterval {
  start_ms: number;
  stable_at_ms?: number;
  end_ms: number;
  occurrence_id?: string;
  state_kind: "slide" | "non_slide";
  recorded_page_state_id?: string;
  recorded_deck_id?: string;
  recorded_page_number?: number;
  equivalent_recorded_page_state_ids: string[];
  content_page_state_id?: string;
  teaching_matcher_page_state_ids: string[];
  teaching_content_page_state_ids: string[];
  revision_relation?: string;
  errata_ids: string[];
  non_slide_kind?: string;
  confidence?: number;
  confidence_margin?: number;
  review_status?: string;

  /** Compatibility aliases used by the original synthetic manifest/tests. */
  page_state_id?: string;
  state?: string;
  occurrence?: number;
}

export interface PageState {
  id: string;
  deck_id: string;
  page: number;
  /** Page within the PDF asset. This can differ from `page` for concatenated decks. */
  asset_page?: number;
  text: string;
  markdown?: string;
  /** Reviewed description of informative visual content on this page. */
  long_description?: string;
  revision: RevisionKind;
  aliases: string[];
  recorded_page_state_ids: string[];
  teaching_page_state_ids: string[];
  /** Compatibility aliases for the former one-to-one adapter. */
  recorded_page_state_id?: string;
  teaching_page_state_id?: string;
  correction?: {
    kind: "erratum" | "correction" | "minor";
    summary: string;
  };
}

export interface RevisionDeckAsset {
  deck_id: string;
  order: number;
  pdf_url?: string;
  download_url?: string;
  page_count?: number;
  page_states: PageState[];
}

export interface RevisionAsset {
  /** Kept for a legacy manifest containing one PDF. */
  pdf_url?: string;
  download_url?: string;
  decks: RevisionDeckAsset[];
  page_states: PageState[];
}

export interface RevisionMapping {
  recorded_page_state_id: string;
  recorded_deck_id: string;
  recorded_page_number: number;
  relation: string;
  teaching_matcher_page_state_ids: string[];
  teaching_content_page_state_ids: string[];
  errata_ids: string[];
}

export interface LectureManifest {
  lecture_id: string;
  title: string;
  content_revision: string;
  presentation: {
    mode: PresentationMode;
    provider?: "youtube" | "google_drive" | "none";
    provider_id?: string;
    external_url?: string;
    video_status?: string;
  };
  revisions: {
    recorded?: RevisionAsset;
    teaching: RevisionAsset;
  };
  revision_mappings: RevisionMapping[];
  cues: CueInterval[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.filter((item): item is string => typeof item === "string" && item.length > 0));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function values(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return Object.values(record(value));
}

function normalizeCorrection(raw: UnknownRecord): PageState["correction"] {
  const revision = record(raw.revision ?? raw.revision_notes);
  const errata = Array.isArray(revision.errata)
    ? revision.errata
    : Array.isArray(raw.errata)
      ? raw.errata
      : [];
  const descriptions = errata
    .map((item) => string(record(item).description ?? record(item).summary))
    .filter(Boolean);
  if (descriptions.length > 0) {
    return { kind: "erratum", summary: descriptions.join(" ") };
  }
  const correction = record(raw.correction ?? raw.erratum);
  if (Object.keys(correction).length === 0) return undefined;
  const kind = string(correction.kind);
  return {
    kind: ["erratum", "correction", "minor"].includes(kind)
      ? (kind as "erratum" | "correction" | "minor")
      : "correction",
    summary: string(correction.summary ?? correction.message ?? correction.description)
  };
}

function normalizePageState(
  rawValue: unknown,
  revision: RevisionKind,
  fallbackId = ""
): PageState {
  const raw = record(rawValue);
  const page = number(raw.page ?? raw.page_number ?? raw.pdf_page);
  const recordedIds = unique([
    ...strings(raw.recorded_page_state_ids),
    string(raw.recorded_page_state_id)
  ].filter(Boolean));
  const teachingIds = unique([
    ...strings(raw.teaching_page_state_ids),
    string(raw.teaching_page_state_id)
  ].filter(Boolean));
  const accessibility = record(raw.accessibility);
  return {
    id: string(raw.id ?? raw.page_state_id, fallbackId),
    deck_id: string(raw.deck_id, "unknown-deck"),
    page,
    asset_page: optionalNumber(raw.asset_page ?? raw.render_page),
    text: string(raw.text ?? raw.extracted_text),
    markdown: string(raw.markdown) || undefined,
    long_description:
      string(raw.long_description ?? accessibility.long_description) || undefined,
    revision,
    aliases: strings(raw.aliases),
    recorded_page_state_ids: recordedIds,
    teaching_page_state_ids: teachingIds,
    recorded_page_state_id: recordedIds[0],
    teaching_page_state_id: teachingIds[0],
    correction: normalizeCorrection(raw)
  };
}

function normalizeMappings(rawValue: unknown): RevisionMapping[] {
  const raw = record(rawValue);
  const mappings = Array.isArray(raw.page_states) ? raw.page_states : [];
  return mappings
    .map((value) => {
      const mapping = record(value);
      return {
        recorded_page_state_id: string(mapping.recorded_page_state_id),
        recorded_deck_id: string(mapping.recorded_deck_id),
        recorded_page_number: number(mapping.recorded_page_number),
        relation: string(mapping.relation, "unresolved"),
        teaching_matcher_page_state_ids: strings(
          mapping.teaching_matcher_page_state_ids ?? mapping.teaching_page_state_ids
        ),
        teaching_content_page_state_ids: strings(mapping.teaching_content_page_state_ids),
        errata_ids: strings(mapping.errata_ids)
      } satisfies RevisionMapping;
    })
    .filter(
      (mapping) =>
        mapping.recorded_page_state_id &&
        mapping.recorded_deck_id &&
        mapping.recorded_page_number > 0
    );
}

function normalizeCues(rawValue: unknown): CueInterval[] {
  return values(rawValue)
    .map((value) => {
      const cue = record(value);
      const recordedId = string(cue.recorded_page_state_id);
      const contentId = string(cue.content_page_state_id);
      const legacyId = string(cue.page_state_id);
      const stateKind = string(cue.state_kind) === "non_slide" || (!recordedId && !contentId && !legacyId)
        ? "non_slide"
        : "slide";
      return {
        start_ms: number(cue.start_ms),
        stable_at_ms: optionalNumber(cue.stable_at_ms),
        end_ms: number(cue.end_ms),
        occurrence_id: string(cue.occurrence_id) || undefined,
        state_kind: stateKind,
        recorded_page_state_id: recordedId || undefined,
        recorded_deck_id: string(cue.recorded_deck_id) || undefined,
        recorded_page_number: optionalNumber(cue.recorded_page_number),
        equivalent_recorded_page_state_ids: strings(cue.equivalent_recorded_page_state_ids),
        content_page_state_id: contentId || undefined,
        teaching_matcher_page_state_ids: strings(
          cue.teaching_matcher_page_state_ids ?? cue.teaching_page_state_ids
        ),
        teaching_content_page_state_ids: strings(cue.teaching_content_page_state_ids),
        revision_relation: string(cue.revision_relation) || undefined,
        errata_ids: strings(cue.errata_ids),
        non_slide_kind: string(cue.non_slide_kind) || undefined,
        confidence: optionalNumber(cue.confidence),
        confidence_margin: optionalNumber(cue.confidence_margin),
        review_status: string(cue.review_status) || undefined,
        page_state_id: legacyId || recordedId || contentId || undefined,
        state: string(cue.state ?? cue.kind ?? cue.non_slide_kind) || undefined,
        occurrence: optionalNumber(cue.occurrence)
      } satisfies CueInterval;
    })
    .filter((cue) => cue.end_ms > cue.start_ms)
    .sort((left, right) => left.start_ms - right.start_ms);
}

function updateMappingLinks(
  teachingStates: PageState[],
  recordedStates: PageState[],
  mappings: readonly RevisionMapping[]
): void {
  const teachingById = new Map(teachingStates.map((state) => [state.id, state]));
  const recordedById = new Map(recordedStates.map((state) => [state.id, state]));
  for (const mapping of mappings) {
    const teachingIds = mapping.teaching_content_page_state_ids;
    let recorded = recordedById.get(mapping.recorded_page_state_id);
    if (!recorded) {
      const teaching = teachingIds.map((id) => teachingById.get(id)).find(Boolean);
      recorded = {
        id: mapping.recorded_page_state_id,
        deck_id: mapping.recorded_deck_id,
        page: mapping.recorded_page_number,
        asset_page: mapping.recorded_page_number,
        text: mapping.relation === "unchanged" ? teaching?.text ?? "" : "",
        revision: "recorded",
        aliases: [],
        recorded_page_state_ids: [],
        teaching_page_state_ids: [...teachingIds],
        teaching_page_state_id: teachingIds[0],
        correction: teaching?.correction
      };
      if (!recorded.correction && mapping.relation !== "unchanged") {
        recorded.correction = {
          kind: "correction",
          summary: `This recorded slide has a ${mapping.relation} mapping to the teaching revision.`
        };
      }
      recordedStates.push(recorded);
      recordedById.set(recorded.id, recorded);
    } else {
      recorded.teaching_page_state_ids = unique([
        ...recorded.teaching_page_state_ids,
        ...teachingIds
      ]);
      recorded.teaching_page_state_id = recorded.teaching_page_state_ids[0];
    }
    for (const teachingId of teachingIds) {
      const teaching = teachingById.get(teachingId);
      if (!teaching) continue;
      teaching.recorded_page_state_ids = unique([
        ...teaching.recorded_page_state_ids,
        mapping.recorded_page_state_id
      ]);
      teaching.recorded_page_state_id = teaching.recorded_page_state_ids[0];
    }
  }
}

function addCueRecordedStates(
  recordedStates: PageState[],
  teachingStates: readonly PageState[],
  cues: readonly CueInterval[]
): void {
  const recordedById = new Map(recordedStates.map((state) => [state.id, state]));
  const teachingById = new Map(teachingStates.map((state) => [state.id, state]));
  for (const cue of cues) {
    if (
      cue.state_kind !== "slide" ||
      !cue.recorded_page_state_id ||
      !cue.recorded_deck_id ||
      !cue.recorded_page_number
    ) continue;
    const teachingIds = unique([
      ...(cue.content_page_state_id ? [cue.content_page_state_id] : []),
      ...cue.teaching_content_page_state_ids
    ]);
    let recorded = recordedById.get(cue.recorded_page_state_id);
    if (!recorded) {
      recorded = {
        id: cue.recorded_page_state_id,
        deck_id: cue.recorded_deck_id,
        page: cue.recorded_page_number,
        asset_page: cue.recorded_page_number,
        text:
          cue.revision_relation === "unchanged"
            ? teachingIds.map((id) => teachingById.get(id)?.text).find(Boolean) ?? ""
            : "",
        revision: "recorded",
        aliases: [],
        recorded_page_state_ids: [],
        teaching_page_state_ids: teachingIds,
        teaching_page_state_id: teachingIds[0]
      };
      recordedStates.push(recorded);
      recordedById.set(recorded.id, recorded);
    }
    recorded.aliases = unique([
      ...recorded.aliases,
      ...cue.equivalent_recorded_page_state_ids.filter((id) => id !== recorded?.id)
    ]);
    recorded.teaching_page_state_ids = unique([
      ...recorded.teaching_page_state_ids,
      ...teachingIds
    ]);
    recorded.teaching_page_state_id = recorded.teaching_page_state_ids[0];
  }
}

function pdfDetails(value: unknown): {
  url?: string;
  pageCount?: number;
} {
  const raw = record(value);
  return {
    url: string(raw.url ?? raw.pdf_url ?? raw.local_pdf_url) || undefined,
    pageCount: optionalNumber(raw.page_count)
  };
}

function canonicalDecks(
  rawDeckValues: unknown[],
  states: PageState[],
  revision: RevisionKind
): RevisionDeckAsset[] {
  return rawDeckValues
    .map((value, index) => {
      const rawDeck = record(value);
      const deckId = string(rawDeck.deck_id, `deck-${index + 1}`);
      const revisionData = record(
        revision === "recorded" ? rawDeck.recorded_revision : rawDeck.teaching_revision
      );
      const pdf = pdfDetails(revisionData.pdf);
      return {
        deck_id: deckId,
        order: number(rawDeck.order, index + 1),
        pdf_url: pdf.url,
        download_url: pdf.url,
        page_count: pdf.pageCount,
        page_states: states
          .filter((state) => state.deck_id === deckId)
          .sort((left, right) => left.page - right.page)
      } satisfies RevisionDeckAsset;
    })
    .filter((deck) => deck.pdf_url || deck.page_states.length > 0)
    .sort((left, right) => left.order - right.order);
}

function legacyDecks(rawValue: unknown, states: PageState[]): RevisionDeckAsset[] {
  const raw = record(rawValue);
  const explicitDecks = Array.isArray(raw.decks) ? raw.decks : [];
  if (explicitDecks.length > 0) {
    return explicitDecks
      .map((value, index) => {
        const deck = record(value);
        const deckId = string(deck.deck_id, `deck-${index + 1}`);
        const deckStatesValue = Array.isArray(deck.page_states) ? deck.page_states : undefined;
        const deckStates = deckStatesValue
          ? deckStatesValue
              .map((state) => normalizePageState(state, states[0]?.revision ?? "teaching"))
              .filter((state) => state.id && state.page > 0)
          : states.filter((state) => state.deck_id === deckId);
        const pdf = pdfDetails(deck.pdf ?? deck);
        return {
          deck_id: deckId,
          order: number(deck.order, index + 1),
          pdf_url: pdf.url,
          download_url: string(deck.download_url) || pdf.url,
          page_count: pdf.pageCount,
          page_states: deckStates
        } satisfies RevisionDeckAsset;
      })
      .sort((left, right) => left.order - right.order);
  }

  const pdf = pdfDetails(raw.pdf ?? raw);
  if (pdf.url) {
    const deckOrder = unique(states.map((state) => state.deck_id));
    const offsets = new Map<string, number>();
    let offset = 0;
    for (const deckId of deckOrder) {
      offsets.set(deckId, offset);
      offset += Math.max(
        0,
        ...states.filter((state) => state.deck_id === deckId).map((state) => state.page)
      );
    }
    const combinedStates = states.map((state) => ({
      ...state,
      asset_page: state.asset_page ?? (offsets.get(state.deck_id) ?? 0) + state.page
    }));
    return [{
      deck_id: deckOrder.length === 1 ? deckOrder[0]! : "combined-decks",
      order: 1,
      pdf_url: pdf.url,
      download_url: string(raw.download_url) || pdf.url,
      page_count: pdf.pageCount,
      page_states: combinedStates
    }];
  }

  return unique(states.map((state) => state.deck_id)).map((deckId, index) => ({
    deck_id: deckId,
    order: index + 1,
    page_states: states.filter((state) => state.deck_id === deckId)
  }));
}

function makeRevision(
  states: PageState[],
  decks: RevisionDeckAsset[],
  rawRevision: unknown
): RevisionAsset {
  const raw = record(rawRevision);
  const topPdf = pdfDetails(raw.pdf ?? raw).url;
  return {
    pdf_url: topPdf ?? (decks.length === 1 ? decks[0]?.pdf_url : undefined),
    download_url:
      string(raw.download_url) || topPdf || (decks.length === 1 ? decks[0]?.download_url : undefined),
    decks,
    page_states: states
  };
}

function findInRevision(asset: RevisionAsset | undefined, stateId: string): PageState | undefined {
  return asset?.page_states.find(
    (state) => state.id === stateId || state.aliases.includes(stateId)
  );
}

export function pageStateForId(
  manifest: LectureManifest,
  stateId: string
): PageState | undefined {
  return (
    findInRevision(manifest.revisions.teaching, stateId) ??
    findInRevision(manifest.revisions.recorded, stateId)
  );
}

export function pageStateIdsForRevision(
  manifest: LectureManifest,
  stateId: string,
  revision: RevisionKind
): string[] {
  const target = manifest.revisions[revision];
  const direct = findInRevision(target, stateId);
  if (direct) return [direct.id];

  const source = pageStateForId(manifest, stateId);
  const linked = source
    ? revision === "teaching"
      ? source.teaching_page_state_ids
      : source.recorded_page_state_ids
    : [];
  const resolved = unique(
    linked.map((id) => findInRevision(target, id)?.id).filter((id): id is string => Boolean(id))
  );
  if (resolved.length > 0) return resolved;

  const mappings = manifest.revision_mappings.filter(
    (mapping) =>
      mapping.recorded_page_state_id === stateId ||
      mapping.teaching_content_page_state_ids.includes(stateId) ||
      mapping.teaching_matcher_page_state_ids.includes(stateId)
  );
  const mapped = revision === "teaching"
    ? mappings.flatMap((mapping) => mapping.teaching_content_page_state_ids)
    : mappings.map((mapping) => mapping.recorded_page_state_id);
  return unique(
    mapped.map((id) => findInRevision(target, id)?.id).filter((id): id is string => Boolean(id))
  );
}

export function pageStateIdForRevision(
  manifest: LectureManifest,
  stateId: string,
  revision: RevisionKind
): string | undefined {
  return pageStateIdsForRevision(manifest, stateId, revision)[0];
}

export function normalizeLectureManifest(rawValue: unknown, lectureId: string): LectureManifest {
  const raw = record(rawValue);
  const presentation = record(raw.presentation);
  const revisions = record(raw.revisions);
  const rawPageStates = raw.page_states;
  const pageStateEntries = Array.isArray(rawPageStates)
    ? rawPageStates.map((value) => ["", value] as const)
    : Object.entries(record(rawPageStates));
  const fallbackTeachingStates = pageStateEntries
    .filter(([, value]) => string(record(value).revision, "teaching") !== "recorded")
    .map(([id, value]) => normalizePageState(value, "teaching", id))
    .filter((state) => state.id && state.page > 0);
  const fallbackRecordedStates = pageStateEntries
    .filter(([, value]) => string(record(value).revision) === "recorded")
    .map(([id, value]) => normalizePageState(value, "recorded", id))
    .filter((state) => state.id && state.page > 0);

  const legacyTeachingRaw = record(revisions.teaching);
  const legacyRecordedRaw = record(revisions.recorded);
  const teachingStateValues = Array.isArray(legacyTeachingRaw.page_states)
    ? legacyTeachingRaw.page_states
    : [];
  const recordedStateValues = Array.isArray(legacyRecordedRaw.page_states)
    ? legacyRecordedRaw.page_states
    : [];
  const teachingStates = teachingStateValues.length > 0
    ? teachingStateValues
        .map((state) => normalizePageState(state, "teaching"))
        .filter((state) => state.id && state.page > 0)
    : fallbackTeachingStates;
  const recordedStates = recordedStateValues.length > 0
    ? recordedStateValues
        .map((state) => normalizePageState(state, "recorded"))
        .filter((state) => state.id && state.page > 0)
    : fallbackRecordedStates;

  const mappings = normalizeMappings(raw.revision_mapping);
  const cueTimeline = record(raw.cue_timeline);
  const legacyTimeline = record(raw.timeline);
  const cues = normalizeCues(
    Array.isArray(raw.cues)
      ? raw.cues
      : Array.isArray(cueTimeline.intervals)
        ? cueTimeline.intervals
        : legacyTimeline.intervals
  );
  updateMappingLinks(teachingStates, recordedStates, mappings);
  addCueRecordedStates(recordedStates, teachingStates, cues);

  const rawDecks = Array.isArray(raw.decks) ? raw.decks : [];
  const teachingDecks = rawDecks.length > 0
    ? canonicalDecks(rawDecks, teachingStates, "teaching")
    : legacyDecks(revisions.teaching, teachingStates);
  const recordedDecks = rawDecks.length > 0
    ? canonicalDecks(rawDecks, recordedStates, "recorded")
    : legacyDecks(revisions.recorded, recordedStates);
  const teaching = makeRevision(teachingStates, teachingDecks, revisions.teaching);
  const recorded = makeRevision(recordedStates, recordedDecks, revisions.recorded);

  const rawMode = string(presentation.mode ?? raw.presentation_mode, "slide_only");
  const mode: PresentationMode = rawMode === "video" || rawMode === "video_lecture"
    ? "video_lecture"
    : rawMode === "external_link_only"
      ? "external_link_only"
      : "slide_only";
  const providerValue = string(
    presentation.provider,
    presentation.provider_id || presentation.youtube_id || raw.youtube_id ? "youtube" : ""
  );
  const provider = ["youtube", "google_drive", "none"].includes(providerValue)
    ? (providerValue as LectureManifest["presentation"]["provider"])
    : undefined;

  return {
    lecture_id: string(raw.lecture_id, lectureId),
    title: string(raw.title, lectureId),
    content_revision: string(raw.content_revision),
    presentation: {
      mode,
      provider,
      provider_id:
        string(presentation.provider_id ?? presentation.youtube_id ?? raw.youtube_id) || undefined,
      external_url:
        string(presentation.external_link ?? presentation.external_url ?? raw.external_url) || undefined,
      video_status: string(presentation.video_status) || undefined
    },
    revisions: {
      recorded:
        recorded.page_states.length > 0 || recorded.decks.some((deck) => deck.pdf_url)
          ? recorded
          : undefined,
      teaching
    },
    revision_mappings: mappings,
    cues
  };
}
