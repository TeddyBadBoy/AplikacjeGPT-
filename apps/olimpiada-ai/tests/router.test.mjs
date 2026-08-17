import assert from 'node:assert/strict';
import { buildPacket, compactContext, routeTask } from '../router.mjs';

const code = routeTask('Zbuduj pełną aplikację i zaimplementuj architekturę repo', 'AUTO');
assert.equal(code.mode, 'SOLO');
assert.equal(code.selected[0].id, 'claude');

const research = routeTask('WYSZUKAJ aktualne ceny i dokumentację API z podaniem źródeł', 'AUTO');
assert.equal(research.mode, 'SOLO');
assert.equal(research.selected[0].id, 'perplexity');

const audit = routeTask('AUDYT: sprawdź i zweryfikuj ten plan', 'AUTO');
assert.equal(audit.selected[0].id, 'chatgpt');

const risky = routeTask('Sprawdź bezpieczeństwo i podatność CVE w tym rozwiązaniu', 'AUTO');
assert.equal(risky.mode, 'DUEL');
assert.equal(risky.selected.length, 2);

const jury = routeTask('Pełna aplikacja end-to-end dotycząca bezpieczeństwa produkcji', 'AUTO');
assert.equal(jury.mode, 'JURY');
assert.equal(jury.selected.length, 4);

const forced = routeTask('zwykła rozmowa', 'JURY');
assert.equal(forced.mode, 'JURY');

const longContext = 'A'.repeat(4000);
assert.ok(compactContext(longContext, 1000).length <= 1000);
assert.match(compactContext(longContext, 1000), /KONTEKST SKRÓCONY/);

const packet = buildPacket({
  task: 'Zaimplementuj synchronizację TickTick → ClickUp',
  context: 'Claude ma dostać tylko minimalny kontekst.',
  requestedMode: 'AUTO'
});
assert.match(packet.packet, /ZADANIE:/);
assert.match(packet.packet, /KONTEKST MINIMALNY:/);

console.log('PASS: Olimpiada AI router tests');
