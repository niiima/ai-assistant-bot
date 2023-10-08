import { Scenes, session, Telegraf } from "telegraf";
import _ from "lodash";

interface MySession extends Scenes.SceneSessionData {
  imageGenerationCount: number;
}

const stage = new Scenes.Stage();

const imgScene = new Scenes.BaseScene("img");
imgScene.enter(async (ctx) => {
  await ctx.reply(
    "Enter number of images to generate (1-9):"
  );
});
imgScene.on("text", async (ctx) => {
  const numChar = _.toNumber(ctx.message.text);
  if (_.isNumber(numChar) && numChar >= 1 && numChar <= 9) {
    ctx.session.imageGenerationCount = numChar;
    await ctx.reply(`🎉 Image generation count set to ${numChar}`);
    await ctx.scene.leave();
    generateImages(ctx, ctx.session.imageGenerationCount);
  } else {
    await ctx.reply("Please enter a number between 1 and 9.");
  }
});
stage.register(imgScene);

function generateImages(ctx, count) {
  const prompt = ctx.message.text.slice(5).trim();
  const uploadPhoto = setInterval(async () => {
    await ctx.sendChatAction("upload_photo");
  }, 1000);
  gpt
    .createImage({
      prompt:
        prompt.length > 0
          ? prompt
          : "Paint a most beautiful painting of stunning situation or landscape in a mix of two different famous painter",
      size: "512x512",
      response_format: "url",
      n: count,
    })
    .then(async (response) => {
      // console.log(response.data);
      if (count === 1)
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
              caption: `${prompt} (${i})`,
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
}

const bot = new Telegraf(token);
bot.use(session());
bot.use(stage.middleware());

bot.command("img", (ctx) => {
  ctx.scene.enter("img");
});

bot.launch();
