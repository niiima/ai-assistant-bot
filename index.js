const chalk = require("chalk");
const {
  Telegraf,
  session
} = require("telegraf");
// const { SessionManager } = require("@puregram/session");
const {
  message
} = require("telegraf/filters");
const {
  Configuration,
  OpenAIApi
} = require("openai");
const ffmpeg = require("fluent-ffmpeg");
const got = require("got");
const fs = require("fs");
const _ = require("lodash");
const {
  encode
} = require("gpt-3-encoder");
const {
  escapeForMarkdown
} = require("./utils/scapeForMarkdown.js");
const commandHandlerMiddleware = require("./middleware/commandHandlerMiddleware.js");
require("dotenv").config();
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const gpt = new OpenAIApi(configuration);
const bot = new Telegraf(process.env.TELEGRAM_BOT_KEY);
const MAX_CONTEXT_TOKENS = 4096;
const MAX_RESPONSE_TOKENS = 1536;
const ERROR_MESSAGE = `⚠️ Something went wrong, please try again.`;
const chatStateInitialProps = {
  isMute: false,
  systemPrompt: "",
  systemPromptLength: 0,
  imageGenerationCount: 1,
  allowedUsers: [],
  activeCommand: "",
  parseMode: "Markdown",
  transcript: false,
};

const getSlicedContext = (dialog, systemPromptLength) => {
  if (dialog.length === 0) return {
    dialog,
    tokens: 0
  };
  const contextLength = dialog.reduce(
    (acc, {
      content
    }) => acc + encode(content).length,
    0
  );
  if (
    contextLength <=
    MAX_CONTEXT_TOKENS - MAX_RESPONSE_TOKENS - systemPromptLength
  ) {
    console.log(chalk.blue(contextLength));
    return {
      dialog,
      tokens: contextLength
    };
  }

  dialog.shift();

  return getSlicedContext(dialog, systemPromptLength);
};

const getState = (ctx) => {
  return {
    ...ctx.session.state[ctx.chat.id],
  };
};

const setState = (ctx, prop, value) => {
  // let stateRef = getState(ctx);
  ctx.session.state[ctx.chat.id] = {
    ...ctx.session.state[ctx.chat.id],
    [prop]: value,
  };
};

const getLogObject = (ctx, slag = {}) => {
  let message_type = ctx.message.text
  ? "text": ctx.message.voice
  ? "voice": "other";
  console.log(chalk.blue(message_type));
  //let message.fileName=ctx.update.message.voice.file_id
  const log = {
    chat_id: ctx.chat.id,
    user_id: ctx.message.from?.id || 0,
    message_type,
    text: ctx?.message?.text || "",
    from: ctx?.message.from?.username || ctx?.message.from?.id || "unknown",
    is_bot: ctx?.message.from?.is_bot,
    date: ctx.message.date,
    ...slag,
  };
  return log;
};

// Main callback
const initSession = (ctx, next) => {
  if (ctx.session) {
    if (!ctx?.session?.dialogs) {
      ctx.session.dialogs = new Map();
    }
  } else try {
    console.log(ctx)
    ctx.sendMessage("session is not available in channels"
    );
    throw new Error({
      message: "session is not available in channels"
    })
  }catch (error) {
    (error)=> {
      console.log(chalk.red(error.message));
    }
    return;
  }
  if (!ctx?.session?.state) {
    ctx.session.state = {
      [ctx.chat.id]: {
        ...chatStateInitialProps,
      },
    };
  } else {
    // let currentList = []
    if (!ctx?.session?.state[ctx.chat.id])
      ctx.session.state = {
      ...ctx.session.state,
      [ctx.chat.id]: {
        ...chatStateInitialProps,
      },
    };
  }
  console.log(`state is:`, ctx);
  return next();
};

const checkAccess = (ctx, next) => {
  if (ctx.session.isAllowed) {
    return next();
  }

  console.log(chalk.red(`checking access for:${JSON.stringify(ctx.message.from)}`));
  let isAllowed = false;
  //if(ctx.chat.id){
  if (ctx.message.from.id) {
    //TELEGRAM_ADMIN_USERctx.message.from.username
    isAllowed = String(process.env.ALLOWED_UDERS || "").split(",").map(id=>_.toNumber(id)).includes(ctx.message.from.id);
    ctx.session.isAllowed = isAllowed;
  }// else if (ctx.robot)
  if (isAllowed) {
    let logObject = getLogObject(ctx);

    fs.appendFileSync(
      `./logs/access-log${ctx.chat.id}.log`,
      JSON.stringify(logObject, null, 0)+ ","
    );
    next();
  } else
  {
    ctx.sendMessage("Access denied! Please send your telegram user name to Bot Admin");
    let {
      _sessionCache,
      logObj
    } = ctx;
    fs.appendFileSync(
      `./logs/unauthorize-access-log${ctx.chat.id}.log`,
      JSON.stringify(logObj, null, 0) + ","
    );
  }
};

const isUserAllowed = (ctx, next) => {
  // if (ctx.session.isAllowed) {
  //   let isUserAllowed = getState(ctx).allowedUsers.includes(
  //     ctx.message.from.username
  //   );
  //   if (isUserAllowed) {
  //     console.log(`isUserAllowed:`, isUserAllowed);
  //   } else console.log("user not allowed", ctx.message.from.username);
  // }
  console.log("user:", ctx.message.from);
  if (ctx.message.text) {
    const logObj = getLogObject(ctx);
    if (logObj.text === "") {
      console.log("no text here:", ctx);
      console.log(ctx.message);
    }
    fs.appendFileSync(
      `./logs/chat-${ctx.chat.id}.log`,
      JSON.stringify(logObj, null, 2) + ","
    );
    //console.log("log:", logObj);
  }
  console.log(ctx.session.usage++);
  return next(); // just testing in dev mode should return if not allowed
};

const getChatCompletion = async(ctx, dialogs)=> {
  const stateRef = getState(ctx);
  console.log("hi")
  try {
    const response = await gpt.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: dialogs,
      max_tokens:MAX_RESPONSE_TOKENS, //MAX_CONTEXT_TOKENS-tokens-stateRef.systemPromptLength-
      
    });
    console.log(response)
    const {
      message
    } = response.data.choices[0];
    const {
      content
    } = message;
    console.log(chalk.blue(content));
    dialogs.push(message);
    console.log(ctx.session.dialogs)
    ctx.session.dialogs.set(ctx.chat.id, dialogs);
    return content;
  } catch (error) {
    console.log(error)
    clearInterval(uploadingAudio);
    clearInterval(typing);
    const openAIError = error.response?.data?.error?.message;

    if (openAIError) {
      console.log(openAIError);
      return await ctx.sendMessage(ERROR_MESSAGE);
    }

    await ctx.sendMessage(
      error?.response?.statusText ?? error.response.description
    );
  }
}

if (process.env.NODE_ENV === "dev") {
  bot.use(Telegraf.log());
}

// bot.use(new SessionManager().middleware);
bot.use(
  session({
    defaultSession: () => ({
      usage: 0,
    }),
  })
);

bot.use(initSession);
bot.use(checkAccess);
bot.use(isUserAllowed);

bot.help(
  async (ctx) => {
    await ctx.sendMessage(
      `
      - /help 💬 - Displays all available commands.

      - /start 🚀 - Starts the bot and greets the user.

      - /reset 🔄 - Starts a new topic with fresh and clear conversation.

      - /system 🖥️ - Provides a system prompt for more accurate answers.

      - /mute 🙊 - Stops bot from responding to messages.

      - /unmute 🔊 - Resumes bot functionality if muted.

      - /img [description] 📸 - Adds your image description after /img to generate an image. You can also set the number of images to be generated by the bot by adding a number after /img, like /img 2.`
    );
  },
  {
    parse_mode: "MarkdownV2",
  }
);

//bot.on(message("sticker"), async (ctx) => await ctx.reply("👍"));

//bot.hears("/hi|Hi|hello|Hello|hey|Hey/", async (ctx, next) => {
//return await ctx.reply(
// "Hello! How can I assist you today? Do you want to see list of available commands? Just click on `help` or type it out to start."
//);
// next();
//});

bot.command("reset", async (ctx) => {
  ctx.session.dialogs.set(ctx.chat.id, []);
  await ctx.sendMessage("🔄 Recent conversation cleared.");
});

bot.command("system", async (ctx) => {
  setState(ctx, "activeCommand", "system");
  await ctx.sendMessage(
    `🔧 Enter a **System prompt** to calibrate responses and provide consistent context for the GPT conversation.
    - /empty to clear current prompt.
    - /cancel to get back.
    ${
    getState(ctx).systemPromptLength > 0
    ? "📟 Current system prompt is: \n" + getState(ctx).systemPrompt: "\n No system prompt provided yet"
    }`,
    {
      parse_mode: "Markdown",
    }
  );
});

bot.command("mute", async (ctx) => {
  setState(ctx, "isMute", true);
  await ctx.sendMessage("Assistant Muted");
});

bot.command("unmute", async (ctx) => {
  //console.log(ctx)
  setState(ctx, "isMute", false);
  await ctx.sendMessage("Assistant Enabled");
});

bot.command("preview", async (ctx) => {
  setState(ctx, "activeCommand", "preview");
  await ctx.sendMessage(
    `🔧 Possible preview modes are:
    - /html
    - /markdown`,
    {
      parse_mode: "Markdown",
    }
  );
});

bot.command("vts", async (ctx) => {
  setState(ctx, "activeCommand", "vtt");
  await ctx.sendMessage(
    `🔧 Switch it on to enable **voice to text** even if Bot is mute.
    - /on
    - /off`,
    {
      parse_mode: "Markdown",
    }
  );
});

bot.command("img", async (ctx) => {
  const stateRef = getState(ctx);
  const prompt = ctx.message.text.slice(5).trim(); // Get the text after "/img "

  if (prompt.length === 1) {
    let numChar = _.toNumber(prompt);
    // console.log(numChar);
    if (_.isNumber(numChar)) {
      if (numChar === 0) {
        return await ctx.sendMessage(
          "🔢 You can choose number of images to generates by Bot from 1 to 9"
        );
      }

      setState(ctx, "imageGenerationCount", numChar);
      return await ctx.sendMessage(
        `🎉 Image generation count set to ${numChar}`
      );
    }
  }

  // if no slag provided
  const uploadPhoto = setInterval(async () => {
    await ctx.sendChatAction("upload_photo");
  }, 1000);
  gpt
  .createImage({
    prompt:
    prompt.length > 0
    ? prompt: "Paint a most beautiful painting of stunning situation or landscape in a mix of two different famous painter",
    size: "512x512",
    response_format: "url",
    n: stateRef.imageGenerationCount,
  })
  .then(async (response) => {
    // console.log(response.data);
    if (stateRef.imageGenerationCount === 1)
      await ctx.replyWithPhoto({
      url: response.data.data[0].url,
    });
    else {
      await ctx.replyWithMediaGroup(
        response.data.data.map((imgData, i) => {
          return {
            media: {
              url: imgData.url,
            },
            type: "photo",
            caption: `${prompt}-(${i})`,
          };
        })
      );
    }
  })
  .catch(async (error) => {
    clearInterval(uploadPhoto);
    console.log(chalk.red(error));
    await ctx.reply(ERROR_MESSAGE);
  })
  .finally(() => clearInterval(uploadPhoto));
});

bot.on(message("voice"), async (ctx) => {
  const chatId = ctx.chat.id;
  const stateRef = getState(ctx);
  if (stateRef.isMute && stateRef.transcript === false) return;
  const uploadingAudio = setInterval(async () => {
    //console.log(ctx.state)
    await ctx.sendChatAction("upload_audio");
  }, 1000);
  //console.log("audio interval initiated")
  try {
    const fileId = ctx.update.message.voice.file_id;

    // download voice message from telegram servers
    const file = await ctx.telegram.getFile(fileId);

    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_KEY}/${file.file_path}`;

    const fileOptions = {
      method: "GET",
      responseType: "buffer",
    };

    const fileData = await got(fileUrl, fileOptions);
    // input file path
    const fileName = `./voices/${fileId}.oga`;
    // Save the downloaded audio file to disk
    fs.writeFileSync(fileName, fileData.body);
    const log = getLogObject(ctx, {
      file: fileName,
    });
    fs.appendFileSync(
      `./logs/chat-${ctx.chat.id}.log`,
      JSON.stringify(log, null, 2) + ","
    );
    const inStream = fs.createReadStream(fileName);
    // create a new command instance
    const command = ffmpeg({
      source: inStream,
    });

    // set the output format and save to output file
    const outputFile = `./voices/${fileId}.mp3`;
    command
    .toFormat("mp3")
    .save(outputFile)
    .on("end", async () => {
      const convertedFile = fs.createReadStream(outputFile);
      // Convert audio to text using Whisper API
      const textResponse = await gpt.createTranscription(
        convertedFile,
        "whisper-1"
      );

      const transcript = textResponse; // psy remove await

      // Send the response back to the user
      let prompt = transcript.data.text;
      // clearInterval(uploadingAudio);
      if (prompt.length === 0) {
        return await ctx.reply("⚠️ Couldn't detect any speech in the voice");
      }
      // psy add await and put
      await ctx.sendMessage(`🎤💬📝: \`${prompt}\` `, {
        parse_mode: "Markdown",
      });
      clearInterval(uploadingAudio);

      if (stateRef.isMute) return;

      const isTest = prompt.length < 5;

      const typing = setInterval(async () => {
        await ctx.sendChatAction("typing");
      }, 1000);

      // Send transcript along with rest of the conversation to get gpt's answer
      if (!ctx.session.dialogs.has(chatId)) {
        ctx.session.dialogs.set(chatId, []);
      }

      let dialogArray = ctx.session.dialogs.get(chatId);

      if (!isTest) {
        dialogArray.push({
          role: "user",
          content: prompt,
        });
      }

      const {
        dialog,
        tokens
      } = getSlicedContext(
        dialogArray,
        stateRef.systemPromptLength
      );

      let dialogs = [];
      if (stateRef.systemPrompt.length > 0)
        dialogs = [{
        role: "system",
        content: stateRef.systemPrompt,
      },
        ...dialog,
      ];
      else dialogs = [...dialog];
      console.log(chalk.green(dialogs));

      try {
        const answer = await getChatCompletion(ctx, dialogs);

        clearInterval(typing);
        await ctx.sendMessage(answer, {
          parse_mode: stateRef.parseMode,
        });

      } catch (error) {
        clearInterval(typing);
        clearInterval(uploadingAudio);
      }
    }).on("error",
      (err) => console.error(err));
  } catch (error) {
    console.error(error);
    await ctx.reply(ERROR_MESSAGE);
  }
});

bot.on(message("text"), async (ctx) => {
  //if (ctx.state.command)
  // console.log(`command from middleware${ctx.state.command.command}`)
  const stateRef = getState(ctx);
  console.log("state:",
    stateRef);
  let isCommandText = false;
  if (stateRef.activeCommand.length > 0) {
    isCommandText = true;
    console.log(`Command:${stateRef.activeCommand}`, ctx);
    let message = "";
    // List commands
    if (stateRef.activeCommand === "system") {
      if (ctx.message.text === "/cancel") {
        message = "📟 Ok, let's get back to the conversation";
      }
      if (ctx.message.text === "/empty") {
        setState(ctx, "systemPromptLength", 0);
        message = "📟 System Prompt removed Successfully";
      } else {
        setState(ctx, "systemPrompt", ctx.message.text);
        setState(ctx, "systemPromptLength", encode(ctx.message.text).length);
        message = "📟 System prompt set successfully.";
      }
    }

    if (stateRef.activeCommand === "preview") {
      if (ctx.message.text === "/html") {
        console.log("Messages parse mode changed to HTML");
        setState(ctx, "parseMode", "HTML");
        message = "📟 Messages parse mode changed to HTML";
      }
      if (ctx.message.text === "/markdown") {
        console.log("📟 Messages parse mode changed to Markdown");

        setState(ctx, "parseMode", "Markdown");
      }
    }

    if (stateRef.activeCommand === "vtt") {
      if (ctx.message.text === "/on") {
        console.log("vtt command set to ON");
        setState(ctx, "transcript", true);
        message = "📟 Text to speech enabled";
      }
      if (ctx.message.text === "/off") {
        console.log("vtt command set to OFF");

        setState(ctx, "transcript", false);

        message = "📟 Text to speech disabled";
      }
    }

    setState(ctx, "activeCommand", "");
    return await ctx.sendMessage(message);
  } else {
    if (isCommandText) return;
    console.log(stateRef)
    if (stateRef.isMute) return;

    const chatId = ctx.chat.id;
    const isTest = ctx.message.text.length < 5;

    const typing = setInterval(async () => {
      await ctx.sendChatAction("typing");
    }, 1000);

    if (!ctx.session.dialogs.has(chatId)) {
      console.log("no chat id")
      ctx.session.dialogs.set(chatId, []);
    }

    let dialogArray = ctx.session.dialogs.get(chatId);

    if (!isTest) {
      dialogArray.push({
        role: "user",
        content: ctx.message.text,
      });
    }

    const {
      dialog,
      tokens
    } = getSlicedContext(dialogArray, stateRef.systemPromptLength);

    let dialogs = [];
    console.log("line 625 Tokens:", tokens)
    if (stateRef.systemPromptLength > 0)
      dialogs = [{
      role: "system",
      content: stateRef.systemPrompt,
    },
      ...dialog,
    ];
    else dialogs = [...dialog];
console.log(dialogs)
    try {
      const answer = await getChatCompletion(ctx, dialogs);
console.log(answer)
      clearInterval(typing);
      await ctx.sendMessage(answer, {
        parse_mode: stateRef.parseMode,
      });

    } catch (error) {
      clearInterval(typing);
    };
  }
});

bot.on('channel_post', (ctx, next) => {
  console.log(ctx.update)
  ctx.update.message = ctx.update.channel_post
  return next()
})

bot.catch((error) => console.error(error));

bot.launch().then(() =>
  bot.start(async (ctx) => {
    console.log("bot started in context");
    ctx.session.dialogs.set(ctx.chat.id, []);
    await ctx.sendMessage("Welcome!");
  })
);

process.once("SIGINT",
  () => bot.stop("SIGINT"));
process.once("SIGTERM",
  () => bot.stop("SIGTERM"));