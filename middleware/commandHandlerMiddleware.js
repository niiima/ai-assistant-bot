const commandHandlerMiddleware = () => (ctx, next) => {
  if (ctx.message.text) {
    const text = ctx.message.text.toLowerCase();
    console.log(`inside midlleware`)
    if (text.startsWith("/")) {
      const match = text.match(/^\/([^\s]+)\s?(.+)?/);
      let args = [];
      let command;
      if (match !== null) {
        if (match[1]) {
          command = match[1];
        }
        if (match[2]) {
          args = match[2].split(" ");
        }
      }

      ctx.state.command = {
        raw: text,
        command,
        args,
      };
    }
  }
  return next();
};

module.exports = commandHandlerMiddleware;
