import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestionPosition } from '../ui/suggestions.js';

test('suggestions flip above and clamp inside the viewport', () => {
    assert.deepEqual(suggestionPosition({ left: 10, top: 20, bottom: 50 }, { width: 100, height: 60 }, { width: 400, height: 300 }), { left: 10, top: 54 });
    assert.deepEqual(suggestionPosition({ left: 390, top: 240, bottom: 270 }, { width: 100, height: 60 }, { width: 400, height: 300 }), { left: 292, top: 176 });
    assert.deepEqual(suggestionPosition({ left: -10, top: 0, bottom: 300 }, { width: 500, height: 500 }, { width: 400, height: 300 }), { left: 8, top: 8 });
});
