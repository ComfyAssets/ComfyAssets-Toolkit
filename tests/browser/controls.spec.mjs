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
