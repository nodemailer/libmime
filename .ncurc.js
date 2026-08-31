module.exports = {
    upgrade: true,
    reject: [
        // 5x is esm only
        'chai',
        // api changes in newer eslint
        'grunt-eslint',
        // 12 is esm only ("type": "module"), and grunt-mocha-test require()s it as a
        // constructor - "Mocha is not a constructor". Node 24 hides this through
        // require(esm); CI on Node 22 does not. Lift it when the runner drops grunt.
        'mocha'
    ]
};
