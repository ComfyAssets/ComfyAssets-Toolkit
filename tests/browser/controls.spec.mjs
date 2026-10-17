import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mapBrowserCoverage } from '../../testing/coverage.mjs';

test.beforeEach(async ({ page }) => {
    if (process.env.TOOLKIT_COVERAGE) await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await page.goto('/');
    await page.evaluate(async () => {
        const ui = await import('/ui/core.js');
        const scope = ui.createScope();
        const element = document.getElementById('controls');
        window.fixture = { ui, scope, element, events: [], settings: new EventTarget() };
        ui.mountTheme(element, fixture.settings, scope);
        const button = ui.createButton('Save', 'ca-primary');
        scope.listen(button, 'click', () => fixture.events.push('save'));
        element.append(button, ui.createSlider('Size', { id: 'size', min: 0, max: 100, step: 1, value: 50, unit: 'px' }, scope, value => fixture.events.push(value)),
            ui.createSwitch('Enabled', 'enabled', 'enabled'),
            ui.createField('Order', ui.createSelect([['name', 'Name'], ['date', 'Date']], 'order'), 'order'),
            ui.createSegments('View', [['grid', 'Grid'], ['list', 'List']], 'view', scope, value => fixture.events.push(value)));
    });
});

test.afterEach(async ({ page }) => {
    if (!process.env.TOOLKIT_COVERAGE) return;
    const entries = await page.coverage.stopJSCoverage();
    const result = mapBrowserCoverage(entries, { urlPrefix: '/ui/', sourceRoot: fileURLToPath(new URL('../../ui/', import.meta.url)) });
    await mkdir(process.env.TOOLKIT_COVERAGE, { recursive: true });
    await writeFile(join(process.env.TOOLKIT_COVERAGE, `browser-${randomUUID()}.json`), JSON.stringify({ result }));
});

test('native controls support keyboard, selections, callbacks and disposal', async ({ page }) => {
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await save.focus();
    await page.keyboard.press('Enter');
    const range = page.getByRole('slider', { name: 'Size' });
    await range.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('output')).toHaveText('51 px');
    await page.getByRole('switch', { name: 'Enabled' }).uncheck();
    await expect(page.getByRole('switch')).not.toBeChecked();
    await page.getByLabel('Order').selectOption('date');
    await expect(page.getByLabel('Order')).toHaveValue('date');
    await page.getByRole('radio', { name: 'List', exact: true }).check();
    expect(await page.evaluate(() => fixture.events)).toEqual(['save', 51, 'list']);
    await page.evaluate(() => fixture.scope.dispose());
    await save.click();
    expect(await page.evaluate(() => fixture.events)).toEqual(['save', 51, 'list']);
});

test('theme follows host changes, falls back to system mode and detaches its observer', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const panel = page.locator('#controls');
    await expect(panel).toHaveAttribute('data-ca-theme', 'dark');
    await page.evaluate(() => document.body.style.setProperty('--bg-color', '#fff'));
    await expect(panel).toHaveAttribute('data-ca-theme', 'light');
    await page.evaluate(() => document.body.style.setProperty('--bg-color', '#222'));
    await expect(panel).toHaveAttribute('data-ca-theme', 'dark');
    await page.evaluate(() => { document.body.style.removeProperty('--bg-color'); fixture.settings.dispatchEvent(new Event('Comfy.ColorPalette.change')); });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(panel).toHaveAttribute('data-ca-theme', 'light');
    await page.evaluate(() => { fixture.scope.dispose(); document.body.style.setProperty('--bg-color', '#222'); });
    await expect(panel).toHaveAttribute('data-ca-theme', 'light');
    expect(await page.evaluate(() => document.querySelectorAll('link[href$="controls.css"]').length)).toBe(1);
});

test('a second mount reuses styles and leaves unrelated controls untouched', async ({ page }) => {
    const result = await page.evaluate(() => {
        const second = document.createElement('main');
        second.className = 'ca-tools';
        document.body.append(second);
        const scope = fixture.ui.createScope();
        fixture.ui.mountTheme(second, null, scope);
        const inside = fixture.element.querySelector('button');
        const outside = document.getElementById('unrelated');
        const result = { styles: document.querySelectorAll('link[href$="controls.css"]').length,
            inside: getComputedStyle(inside).backgroundColor, outside: getComputedStyle(outside).backgroundColor };
        scope.dispose();
        second.remove();
        return result;
    });
    expect(result.styles).toBe(1);
    expect(result.inside).not.toBe(result.outside);
});


test('suggestions render safe optional badges, retain input focus and dispose old options', async ({ page }) => {
    await page.evaluate(async () => {
        const { createSuggestionView } = await import('/ui/suggestions.js');
        fixture.suggestions = createSuggestionView(fixture.scope, fixture.settings, { label: 'Existing tags' });
        fixture.items = [{ name: '<b>portrait</b>' }, { name: 'model', type: 'embedding', fullPath: 'folder/model' }, { name: 'style', type: 'lora' }, { name: 'tag', type: 'custom' }];
        fixture.suggestions.render(fixture.items, index => fixture.events.push(index), item => fixture.events.push(item.name));
        fixture.suggestions.position({ left: 10, top: 10, bottom: 30 });
    });
    const popup = page.getByRole('listbox', { name: 'Existing tags' });
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('option')).toHaveCount(4);
    await expect(popup.locator('b')).toHaveCount(0);
    await expect(popup.locator('.ca-completion-type')).toHaveText(['[EMB]', '[LORA]', '[TAG]']);
    await expect(popup.locator('.ca-completion-directory')).toHaveText('folder/');
    const input = page.getByLabel('Order');
    await input.focus();
    await popup.getByRole('option').first().click();
    await expect(input).toBeFocused();
    const id = await page.evaluate(() => fixture.suggestions.select(1));
    await expect(popup.getByRole('option').nth(1)).toHaveAttribute('id', id);
    await expect(popup.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => fixture.suggestions.select(-1))).toBeUndefined();
    await page.evaluate(() => {
        fixture.oldOption = fixture.suggestions.element.firstElementChild;
        fixture.suggestions.hide();
        fixture.oldOption.click();
        fixture.suggestions.render([{ name: 'replacement' }], () => {}, () => {});
    });
    expect(await page.evaluate(() => fixture.events.filter(value => value === '<b>portrait</b>'))).toHaveLength(1);
    await expect(popup.getByRole('option')).toHaveText('replacement');
    await page.evaluate(() => fixture.scope.dispose());
    await expect(popup).toHaveCount(0);
});

test('suggestions default label and viewport limits work on touch and narrow screens', async ({ page }) => {
    await page.evaluate(async () => {
        const { createSuggestionView } = await import('/ui/suggestions.js');
        fixture.suggestions = createSuggestionView(fixture.scope, null);
        fixture.suggestions.render([{ name: 'plain', type: 'embedding' }], () => {}, () => {});
        fixture.suggestions.position({ left: innerWidth - 1, top: innerHeight - 50, bottom: innerHeight - 20 });
    });
    const popup = page.getByRole('listbox', { name: 'Suggestions', exact: true });
    await expect(popup).toBeVisible();
    const box = await popup.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 8);
    await page.evaluate(() => fixture.suggestions.hide());
    await expect(popup).toBeHidden();
});


test('independent bundled copies allocate distinct suggestion IDs without secure-context APIs', async ({ page }) => {
    const ids = await page.evaluate(async () => {
        Object.defineProperty(Crypto.prototype, 'randomUUID', { configurable: true, value: undefined });
        const first = await import('/ui/suggestions.js?pack=first');
        const second = await import('/ui/suggestions.js?pack=second');
        const a = first.createSuggestionView(fixture.scope, null);
        const b = second.createSuggestionView(fixture.scope, null);
        a.render([{ name: 'first' }], () => {}, () => {});
        b.render([{ name: 'second' }], () => {}, () => {});
        return [a.element.id, b.element.id, a.select(0), b.select(0)];
    });
    expect(new Set(ids).size).toBe(4);
});
