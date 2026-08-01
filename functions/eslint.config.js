"use strict";

const globals = require("globals");
const js = require("@eslint/js");

module.exports = [
    js.configs.recommended,

    {
        files: ["**/*.js"],

        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "commonjs",

            globals: {
                ...globals.node
            }
        },

        rules: {
            "indent": ["error", 4, {
                "SwitchCase": 1
            }],

            "quotes": [
                "error",
                "double",
                {
                    "allowTemplateLiterals": true,
                    "avoidEscape": true
                }
            ],

            "semi": ["error", "always"],
            "comma-dangle": ["error", "never"],
            "object-curly-spacing": ["error", "always"],
            "array-bracket-spacing": ["error", "never"],
            "space-before-function-paren": [
                "error",
                {
                    "anonymous": "always",
                    "named": "never",
                    "asyncArrow": "always"
                }
            ],

            "max-len": [
                "error",
                {
                    "code": 100,
                    "ignoreUrls": true,
                    "ignoreStrings": true,
                    "ignoreTemplateLiterals": true
                }
            ],

            "no-console": "off",
            "no-unused-vars": [
                "error",
                {
                    "argsIgnorePattern": "^_",
                    "varsIgnorePattern": "^_"
                }
            ]
        }
    },

    {
        ignores: [
            "node_modules/**",
            "coverage/**",
            "lib/**",
            ".firebase/**",
            "firebase-debug.log",
            "*.local.js"
        ]
    }
];