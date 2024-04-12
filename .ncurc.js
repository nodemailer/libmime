module.exports = {
    upgrade: true,
    reject: [
        // 5x is esm only
        'chai',
        // api changes in newer eslint
        'grunt-eslint'
    ]
};
