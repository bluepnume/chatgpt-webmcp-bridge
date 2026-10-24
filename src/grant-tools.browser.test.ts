import { grantToolsToFrames } from './grant-tools';

describe('giving frames the tools permission', () => {
    beforeAll(() => {
        grantToolsToFrames();
        // A second run changes nothing.
        grantToolsToFrames();
    });

    it('adds tools to frames however they are added or pointed at a page', () => {
        const container = document.createElement('div');
        const appended = document.createElement('iframe');
        const prepended = document.createElement('iframe');
        const before = document.createElement('iframe');
        const replacement = document.createElement('iframe');
        const sourced = document.createElement('iframe');
        const kept = document.createElement('iframe');

        kept.setAttribute('allow', 'fullscreen *');
        document.body.append(container);
        container.appendChild(appended);
        container.prepend(prepended);
        appended.before(before);
        container.append(kept);
        appended.replaceWith(replacement);
        sourced.src = 'about:blank';

        for (const frame of [ appended, prepended, before, replacement, sourced ]) {
            expect(frame.getAttribute('allow')).toBe('tools *');
        }

        expect(kept.getAttribute('allow')).toBe('fullscreen *; tools *');
        container.remove();
    });

    it('leaves a frame that already has tools, and other elements, alone', () => {
        const frame = document.createElement('iframe');
        const div = document.createElement('div');

        frame.setAttribute('allow', 'tools \'self\'');
        document.body.insertBefore(frame, document.body.firstChild);
        document.body.append(div);

        expect(frame.getAttribute('allow')).toBe('tools \'self\'');
        expect(div.hasAttribute('allow')).toBe(false);
        frame.remove();
        div.remove();
    });
});
