const SPECIAL_CHARS = [
  "\\",
  "_",
  "*",
  "[",
  "]",
  "(",
  ")",
  "~",
  "`",
  ">",
  "<",
  "&",
  "#",
  "+",
  "-",
  "=",
  "|",
  "{",
  "}",
  ".",
  "!",
];

module.exports = {
  escapeForMarkdown: (text) => {
    SPECIAL_CHARS.forEach(
      (char) => (text = text.replaceAll(char, `\\${char}`))
    );
    return text;
  },
};
