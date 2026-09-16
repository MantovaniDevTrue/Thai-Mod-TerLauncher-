export function resolveOptional(owner, signatures) {
    const list = Array.isArray(signatures) ? signatures : [signatures];

    for (const signature of list) {
        try {
            return owner[signature];
        } catch (_) { }
    }

    return null;
}

export function hookOptional(owner, signature, hook) {
    const method = resolveOptional(owner, signature);
    if (!method) return false;
    method.hook(hook);
    return true;
}
