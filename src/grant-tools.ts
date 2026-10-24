// Gives every iframe the "tools" permission, so native WebMCP works inside
// frames. Runs in a page before its own code (the Chrome launcher installs it
// in every page and frame), and adds "tools *" to each iframe's allow
// attribute just before the frame is added or pointed at a URL; the browser
// reads allow when the frame loads.
//
// It stands in for ChatGPT, which frames plugin panels without "tools". It
// must be one self-contained function: the launcher sends its source text to
// the browser.

export const grantToolsToFrames = () : void => {
    const marker = '__chatgptWebmcpBridgeGrantsTools';
    const scope = window as unknown as Record<string, boolean | undefined>;

    if (scope[marker]) {
        return;
    }

    scope[marker] = true;

    const grant = (node : unknown) : void => {
        if (!(node instanceof HTMLIFrameElement)) {
            return;
        }

        const allow = node.getAttribute('allow') ?? '';

        if (!(/(?:^|;)\s*tools\b/).test(allow)) {
            node.setAttribute('allow', allow
                ? `${ allow }; tools *`
                : 'tools *');
        }
    };

    const wrap = (prototype : object, name : string) : void => {
        const original = (prototype as Record<string, unknown>)[name] as (...args : Array<unknown>) => unknown;

        Object.defineProperty(prototype, name, {
            configurable: true,
            writable:     true,

            value(this : unknown, ...args : Array<unknown>) : unknown {
                for (const arg of args) {
                    grant(arg);
                }

                return original.apply(this, args);
            }
        });
    };

    for (const name of [ 'appendChild', 'insertBefore', 'replaceChild' ]) {
        wrap(Node.prototype, name);
    }

    for (const name of [ 'append', 'prepend', 'before', 'after', 'replaceWith' ]) {
        wrap(Element.prototype, name);
    }

    const source = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');

    if (source?.set) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the frame as this, like the original
        const setSource = source.set;

        Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
            ...source,

            set(this : HTMLIFrameElement, value : string) : void {
                grant(this);

                Reflect.apply(setSource, this, [ value ]);
            }
        });
    }
};
