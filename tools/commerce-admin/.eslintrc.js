/**
 * Commerce-admin scripts use many mutually recursive `function` declarations.
 * Airbnb enables `no-use-before-define` for functions; relax only here.
 */
module.exports = {
  rules: {
    'no-use-before-define': ['error', {
      functions: false,
      classes: true,
      variables: true,
    }],
    'no-alert': 'off',
  },
};
