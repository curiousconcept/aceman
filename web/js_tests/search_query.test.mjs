// Tests for the /api/search query helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_QUERY_LEN, shouldSearch, normaliseQuery, buildSearchUrl,
} from '../js/lib/search_query.js';

test('MIN_QUERY_LEN matches upstream policy (2 chars)', () => {
  assert.equal(MIN_QUERY_LEN, 2);
});

test('shouldSearch — under threshold → false', () => {
  assert.equal(shouldSearch(''), false);
  assert.equal(shouldSearch('a'), false);
  assert.equal(shouldSearch(' a '), false, 'whitespace trimmed first');
});

test('shouldSearch — at or above threshold → true', () => {
  assert.equal(shouldSearch('ab'), true);
  assert.equal(shouldSearch('  ab  '), true);
  assert.equal(shouldSearch('hello world'), true);
});

test('shouldSearch — non-string is false (no crash)', () => {
  assert.equal(shouldSearch(null), false);
  assert.equal(shouldSearch(undefined), false);
  assert.equal(shouldSearch(42), false);
});

test('normaliseQuery — trims; non-string yields empty', () => {
  assert.equal(normaliseQuery('  hi  '), 'hi');
  assert.equal(normaliseQuery(null), '');
  assert.equal(normaliseQuery(undefined), '');
  assert.equal(normaliseQuery(42), '');
});

test('buildSearchUrl — percent-encodes the query', () => {
  assert.equal(buildSearchUrl('hello world'),
               '/api/search?q=hello%20world');
  assert.equal(buildSearchUrl('  hi  '),
               '/api/search?q=hi');
});

test('buildSearchUrl — encodes URL-significant characters', () => {
  // Anything with &, =, ?, # would corrupt the URL if not encoded —
  // the encoding is the safety mechanism we depend on.
  const url = buildSearchUrl('a&b=c?d#e');
  assert.equal(url, '/api/search?q=a%26b%3Dc%3Fd%23e');
});

test('buildSearchUrl — Cyrillic round-trips through decodeURIComponent', () => {
  const url = buildSearchUrl('Спорт');
  const after = decodeURIComponent(url.split('?q=')[1]);
  assert.equal(after, 'Спорт');
});

test('buildSearchUrl — custom base works', () => {
  assert.equal(buildSearchUrl('hi', '/other'),
               '/other?q=hi');
});
