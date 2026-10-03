import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../db.js";
import { linkCardReferences, type CardResolver } from "../shared.js";
import { linkCardsInHtml } from "../card-link-resolver.js";

const known: CardResolver = (displayId) =>
  displayId === "IDE-318"
    ? { id: "u-318", displayId, title: "Plan & opinion" }
    : null;

const chip318 =
  '<span data-type="cardMention" data-id="u-318" data-display-id="IDE-318" data-title="Plan &amp; opinion"' +
  ' class="mention card-mention">[[IDE-318 · Plan &amp; opinion]]</span>';

test("a known displayId becomes a card chip, an unknown one stays text", () => {
  assert.equal(
    linkCardReferences("<li><p><strong>IDE-318</strong> (completed): UTF-8 and IDE-999</p></li>", known),
    `<li><p><strong>${chip318}</strong> (completed): UTF-8 and IDE-999</p></li>`
  );
});

test("a hand-typed [[IDE-318 · title]] is replaced whole, brackets included", () => {
  assert.equal(linkCardReferences("<p>see [[IDE-318 · old title]].</p>", known), `<p>see ${chip318}.</p>`);
});

test("code, links and existing mentions are left alone, and a second pass changes nothing", () => {
  const html =
    "<p><code>IDE-318</code> <a href=\"x\">IDE-318</a> " +
    '<span data-type="cardMention" data-id="u-318">[[IDE-318]]</span> IDE-318</p><pre><code>IDE-318</code></pre>';
  const once = linkCardReferences(html, known);
  assert.equal(
    once,
    "<p><code>IDE-318</code> <a href=\"x\">IDE-318</a> " +
      `<span data-type="cardMention" data-id="u-318">[[IDE-318]]</span> ${chip318}</p><pre><code>IDE-318</code></pre>`
  );
  assert.equal(linkCardReferences(once, known), once);
});

test("only a card's first mention becomes a chip, a hand-typed repeat loses its brackets", () => {
  assert.equal(
    linkCardReferences("<p>IDE-318 first, IDE-318 again, [[IDE-318 · x]] typed</p>", known),
    `<p>${chip318} first, IDE-318 again, IDE-318 typed</p>`
  );
});

test("the resolver prefers the card's own project when two share a prefix", () => {
  const db = openDatabase(":memory:");
  db.exec(`CREATE TABLE projects (id TEXT, id_prefix TEXT);
           CREATE TABLE cards (id TEXT, title TEXT, project_id TEXT, task_number INTEGER);
           INSERT INTO projects VALUES ('p1','IDE'),('p2','IDE'),('p3','INK');
           INSERT INTO cards VALUES ('a','in p1','p1',5),('b','in p2','p2',5),('c','ink','p3',7);`);
  assert.match(linkCardsInHtml(db, "<p>IDE-5</p>", "p2"), /data-id="b"/);
  // Ambiguous prefix outside the card's project: no guess.
  assert.equal(linkCardsInHtml(db, "<p>IDE-5</p>", "p3"), "<p>IDE-5</p>");
  // A unique prefix resolves across projects.
  assert.match(linkCardsInHtml(db, "<p>INK-7</p>", "p1"), /data-id="c"/);
});
