/**
 * Intent gate for the generator endpoint.
 *
 * The assistant must change the UI ONLY when the user asks for a change. Greetings, questions,
 * opinions and feedback ("what do you think of this design?") get a conversational reply and leave
 * the UI alone. Two signals decide:
 *
 *   1. the model labels its own answer with `intent` (design | chat | clarify), and
 *   2. `classifyIntent` reads the message locally with cheap, explainable rules.
 *
 * `resolveIntent` combines them conservatively: code is applied only when the model says "design"
 * AND the local classifier does not confidently read the message as chat. An uninvited redesign is
 * the worse failure, so ties go to "chat".
 */

export const INTENTS = ['design', 'chat', 'clarify'];

const GREETING = /^(hi|hey|hello|yo|hiya|howdy|good (morning|afternoon|evening)|selam|merhaba|hola|bonjour|ciao)\b/i;
const THANKS = /^((thanks?|thank you|thx|ty|cheers|great|awesome|nice|cool|perfect|love it|looks good|lgtm|ok(ay)?|good job|well done|wow|amazing|beautiful)[\s!.,]*)+$/i;
const HOW_ARE_YOU = /\b(how are you|how('?s| is) it going|what'?s up|how do you do)\b/i;
const OPINION = /\b(what do you think|your (opinion|thoughts|take)|do you (like|think)|thoughts\??|how does (this|it) look|is (this|it) (good|ok|fine|nice))\b/i;
const QUESTION_WORDS = /^(what|why|how|when|where|who|which|can you|could you|do you|does|is|are|will|should|would)\b/i;
const CAPABILITY_QUESTION = /\b(what can you do|what are you|who are you|help me understand|explain|tell me about|how does this work|what is this)\b/i;
const CHANGE_VERBS = /\b(make|turn|convert|change|switch|show|display|add|remove|delete|hide|put|move|place|group|sort|order|filter|arrange|create|build|redesign|render|draw|give me|i want|i'?d like|i need|let'?s have|please|can you (make|add|show|change|turn|build|create|remove|put|group|sort)|design (a|an|me|the|something|it|this))\b/i;
const UI_NOUNS = /\b(kanban|board|calendar|table|list|grid|card|cards|column|columns|dashboard|chart|timeline|gallery|view|layout|button|header|title|color|colour|font|dark|light|theme|bigger|smaller|wider|compact|dense|spacing|badge|filter|filters|tab|tabs|sidebar|row|rows|section|page|ui|design|style)\b/i;
const UNDO_REDO = /^(undo|redo|revert|go back|reset|restore)\b/i;
const VAGUE_CHANGE = /^(make it (better|nicer|prettier|good|great|pop|cleaner)|improve( it| this)?|fix( it| this)?|better|nicer|change it|something else|do something|surprise me)[\s!.]*$/i;

/**
 * @param {string} message
 * @param {{ history?: Array<{ role: string, content: string }> }} [ctx]
 * @returns {{ intent: 'design'|'chat'|'clarify'|'unknown', confidence: 'high'|'medium'|'low', reasons: string[] }}
 */
export function classifyIntent(message, ctx = {}) {
  const m = String(message || '').trim();
  const reasons = [];
  if (!m) return { intent: 'chat', confidence: 'high', reasons: ['empty'] };
  const words = m.split(/\s+/).length;
  const endsWithQuestion = /\?\s*$/.test(m);

  if (UNDO_REDO.test(m)) return { intent: 'design', confidence: 'high', reasons: ['undo/redo/reset verb'] };
  if (VAGUE_CHANGE.test(m)) return { intent: 'clarify', confidence: 'high', reasons: ['vague change request'] };

  const hasChangeVerb = CHANGE_VERBS.test(m);
  const hasUiNoun = UI_NOUNS.test(m);

  const asksForChange = hasChangeVerb && hasUiNoun; // "hi, make it a kanban" / "how does it look if we make the cards bigger?"
  if (THANKS.test(m)) return { intent: 'chat', confidence: 'high', reasons: ['acknowledgement'] };
  if (HOW_ARE_YOU.test(m) && !hasChangeVerb) return { intent: 'chat', confidence: 'high', reasons: ['small talk'] };
  if (GREETING.test(m) && words <= 4 && !asksForChange) return { intent: 'chat', confidence: 'high', reasons: ['greeting'] };
  if (OPINION.test(m) && !asksForChange) return { intent: 'chat', confidence: 'high', reasons: ['asks for an opinion'] };
  if (OPINION.test(m) && asksForChange) return { intent: 'design', confidence: 'medium', reasons: ['opinion phrasing but asks for a change'] };
  if (GREETING.test(m) && asksForChange) return { intent: 'design', confidence: 'medium', reasons: ['greeting followed by a change request'] };
  if (CAPABILITY_QUESTION.test(m) && !hasChangeVerb) return { intent: 'chat', confidence: 'high', reasons: ['asks about capabilities'] };

  if (hasChangeVerb && hasUiNoun) {
    reasons.push('change verb + UI noun');
    return { intent: 'design', confidence: endsWithQuestion ? 'medium' : 'high', reasons };
  }
  if (hasChangeVerb) return { intent: 'design', confidence: 'medium', reasons: ['change verb'] };
  if (endsWithQuestion || QUESTION_WORDS.test(m)) {
    reasons.push('question form without a change verb');
    return { intent: 'chat', confidence: hasUiNoun ? 'medium' : 'high', reasons };
  }
  if (hasUiNoun && words <= 3) return { intent: 'design', confidence: 'low', reasons: ['bare UI noun, e.g. "kanban"'] };
  if (GREETING.test(m)) return { intent: 'chat', confidence: 'medium', reasons: ['starts with a greeting'] };
  return { intent: 'unknown', confidence: 'low', reasons: ['no strong signal'] };
}

// ---------------------------------------------------------------------------------------------
// Scope: is this a small tweak to the current UI (edit mode: the model returns search/replace
// edits, ~10× fewer output tokens) or a new view (design mode: the model returns the whole
// component)? Edit mode is only ever an optimisation — a failed edit falls back to design mode —
// so the classifier leans towards `design` whenever the message could mean a new layout.
// ---------------------------------------------------------------------------------------------
const NEW_VIEW = /\b(kanban|board|calendar|dashboard|timeline|gallery|chart|graph|table|grid view|list view|redesign|rebuild|recreate|from scratch|start over|new (layout|design|view|page|look)|whole (page|thing|ui|view)|entire|everything|completely|totally|different (layout|design|view)|instead of|convert|turn (it|this|the page) into|make (it|this|the page) (a|an|into)|switch to|reorganis|reorganiz|rearrange|group(ed)? by|sort(ed)? by|split into|two columns|three columns|side by side)\b/i;
const TWEAK = /\b(collaps\w*|expand\w*|toggle|fold\w*|accordion|hide|show|reveal|rename|relabel|label|wording|text|copy|button|icon|emoji|color|colour|tint|border|outline|round\w*|shadow|padding|margin|spacing|gap|tighter|looser|font|bold\w*|italic|size|bigger|smaller|larger|wider|narrower|taller|shorter|align\w*|cent(er|re)\w*|tooltip|placeholder|hover|disable\w*|enable\w*|remove (the|that|this)|delete (the|that|this)|add (a|an|the|some)|move (the|that|this)|swap|reorder|dark(er)?|light(er)?|compact|dense|opacity|highlight\w*|badge|chip|tag|underline|uppercase|lowercase|capitali[sz]e|title|heading|header|footer|look|style|appearance|theme|card|cards|row|rows|column header|stat|counter|progress|bar|animation|transition)\b/i;

/**
 * @param {string} message
 * @param {{ currentUI?: string, history?: Array }} [ctx]
 * @returns {'edit'|'design'}
 */
export function classifyScope(message, ctx = {}) {
  const m = String(message || '').trim();
  if (!ctx.currentUI || !m) return 'design';
  if (UNDO_REDO.test(m) || VAGUE_CHANGE.test(m)) return 'design';
  const words = m.split(/\s+/).length;
  if (words > 25) return 'design';
  if (NEW_VIEW.test(m)) return 'design';
  // "a header, a search box and a footer": three or more parts at once is a redesign, not a tweak.
  if ((m.match(/,|\band\b|\bplus\b|\balso\b/gi) || []).length >= 2) return 'design';
  if (TWEAK.test(m)) return 'edit';
  // A short change request that names neither a new view nor a known tweak word ("show the tasks
  // as a list", or a non-English phrasing): try edit mode. The edit prompt lets the model answer
  // with full code if it judges the change too large, so the cost of guessing wrong is small.
  if (words <= 15 && CHANGE_VERBS.test(m)) return 'edit';
  return 'design';
}

/**
 * Combine the model's label with the local read. Only `design` applies code.
 * @returns {'design'|'chat'|'clarify'}
 */
export function resolveIntent({ modelIntent, hasCode, heuristic }) {
  const model = INTENTS.includes(modelIntent) ? modelIntent : hasCode ? 'design' : 'chat';
  const local = heuristic && heuristic.intent ? heuristic : { intent: 'unknown', confidence: 'low' };
  if (model === 'design') {
    // A confident local "chat" overrides the model: e.g. "what do you think of this design?"
    if (local.intent === 'chat' && local.confidence === 'high') return 'chat';
    if (local.intent === 'clarify' && local.confidence === 'high' && !hasCode) return 'clarify';
    return 'design';
  }
  if (model === 'clarify') return 'clarify';
  return 'chat';
}
