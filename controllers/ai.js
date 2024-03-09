const openAi = require("../common/openAi");
const OpenAi = require("../models/OpenAi");
const Message = require("../models/Message");
const Room = require("../models/Room");
const Saved = require("../models/Saved");
const User = require("../models/User");
const s3Client = require("../config/s3Client");
const axios = require("axios");
const fs = require("fs");
const http = require("https");
const path = require("path");

const uploadParams = {
  Bucket: "mymarvin-storage",
  Key: "", // pass key
  Body: null, // pass file body
};

const get_url_extension = (url) => {
  return url.split(/[#?]/)[0].split(".").pop().trim();
};

const createRoom = async (req, res) => {
  try {
    const { use } = req.user;
    const { type } = req.body;
    const newRoom = new Room({
      type,
      user: use._id,
      title: type === "images" ? "New images" : "New chat",
    });
    await newRoom.save();
    res.status(201).json(newRoom);
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Send message failed",
    });
  }
};

const getGeneralRooms = async (req, res) => {
  try {
    const { use } = req.user;
    console.log(use._id, "------------");
    const rooms = await Room.find({ user: use._id, isGeneral: true })
      .select("-messages")
      .exec();
    console.log("rooms: ", rooms);

    res.status(200).json(rooms);
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Send message failed",
    });
  }
};

const createMessage = async (req, res) => {
  try {
    const { prompt, roomId, type } = req.body;
    const { use } = req.user;

    const options = {
      prompt,
    };
    let completion = null;

    const user = await User.findById(use._id).select("-password").exec();
    user.balance = user.balance - 1;
    console.log("user: ", user);
    await user.save();

    if (type === "images") {
      options["size"] = "512x512";
      options["n"] = 1;
      options["response_format"] = "b64_json";
      console.log("options: ", options);

      completion = await openAi.createImage(options);

      const imgData = completion.data;
      const imgCreate = imgData.data[0];

      const finalImage = await new Buffer.from(imgCreate.b64_json, "base64");

      const params = uploadParams;

      uploadParams.Key = `generated_images/${
        use._id
      }_${Date.now().toString()}.png`;
      uploadParams.Body = finalImage;

      await s3Client.upload(params, async (err, data) => {
        if (err) {
          console.log("err: ", err);
          res.status(400).json({ error: "Error -> " + err });
        }

        const message = new Message({
          prompt,
          type,
          response: completion.data,
          image: data,
        });

        await message.save();

        if (!roomId) {
          // create new room
          const newRoom = new Room({
            title: prompt,
            user: use._id,
            type,
            messages: [message],
          });

          await newRoom.save();
          res.status(201).json({ message, room: newRoom });
        } else {
          // update room
          const room = await Room.findById(roomId).exec();
          if (
            room.title === `New ${room.type === "images" ? "images" : "chat"}`
          ) {
            room.title = prompt;
          }
          const newMessages = room.messages;
          newMessages.push(message);
          room.messages = newMessages;
          await room.save();
          res.status(201).json({ message, room });
        }
      });
    } else {
      options["model"] = "text-davinci-003";
      options["max_tokens"] = 2048;
      console.log("options: ", options);
      completion = await openAi.createCompletion(options);
      console.log(">> comp: ", completion.data);

      const message = new Message({
        prompt,
        type,
        response: completion.data,
      });

      await message.save();

      if (!roomId) {
        // create new room
        const newRoom = new Room({
          title: prompt,
          user: use._id,
          type,
          messages: [message],
        });

        await newRoom.save();
        console.log("newRoom: ", newRoom);
        res.status(201).json({ message, room: newRoom });
      } else {
        // update room
        const room = await Room.findById(roomId).exec();
        if (
          room.title === `New ${room.type === "images" ? "images" : "chat"}`
        ) {
          room.title = prompt;
        }
        const newMessages = room.messages;
        newMessages.push(message);
        room.messages = newMessages;
        await room.save();
        console.log("room: ", room);
        res.status(201).json({ message, room });
      }
    }
  } catch (error) {
    console.log(">> err 11: ", error.response.data);
    res.status(400).json({
      message:
        error.response && error.response.data && error.response.data.error
          ? error.response.data.error.message
          : "Send message failed",
    });
  }
};

const getMessage = async (req, res) => {
  try {
    const { id } = req.body;
    const existMessage = await Message.findOne({
      _id: id,
    });

    if (existMessage) {
      res.status(200).json(existMessage);
    } else {
      const existSaved = await Saved.findOne({
        _id: id,
      });
      if (existSaved) {
        res.status(200).json(existSaved);
      }
    }
  } catch (error) {
    console.log(">> err 11: ", error);
    res.status(400).json({
      message: "Failed get Message",
    });
  }
};

const getRooms = async (req, res) => {
  try {
    const { use } = req.user;
    const rooms = await Room.find({
      user: use._id,
      isGeneral: false,
    })
      .populate("user", "-password")
      .sort("-createdAt")
      .exec();

    res.status(200).json(rooms);
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Get rooms failed",
    });
  }
};

const getMessageDetail = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(">> id: ", id);

    const message = await Message.findById(id).exec();

    res.status(200).json(message);
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Get message detail failed",
    });
  }
};

const deleteRoom = async (req, res) => {
  try {
    const { use } = req.user;
    const { roomId } = req.params;
    const room = await Room.findOneAndDelete({ _id: roomId, user: use._id });
    res.status(200).json({
      message: "Deleted successfully",
    });
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Delete rooms failed",
    });
  }
};

const updateTitleOfRoom = async (req, res) => {
  try {
    const { use } = req.user;
    const { roomId } = req.params;
    const { title } = req.body;
    const room = await Room.findOne({
      user: use._id,
      _id: roomId,
    }).exec();
    room.title = title;
    await room.save();

    res.status(200).json({
      message: "Title is updated",
    });
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Get rooms failed",
    });
  }
};

const getMessagesOfRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit, page } = req.query;
    const room = await Room.findById(roomId)
      .populate("user", "-password")
      .populate("messages")
      .sort("-createdAt")
      .exec();

    const totalMessages = room.messages;
    const from = totalMessages.length - limit * (page - 1);
    const to = totalMessages.length - limit * page;
    console.log(from, to);
    // totalMessages.reverse();

    const messages = totalMessages.slice(
      // to < totalMessages.length ? to : totalMessages.length,
      to > 0 ? to : 0,
      from
    );
    console.log("messages: ", messages);
    // messages.reverse();
    res.status(200).json({
      room: {
        _id: room._id,
        user: room.user,
        type: room.user,
        type: room.type,
        title: room.title,
        isGeneral: room.isGeneral,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
      },
      messages,
    });
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Can't get messages of room",
    });
  }
};

const createPoem = async (req, res) => {
  try {
    const { prompt } = req.body;
    const { use } = req.user;

    const newPoem = await openAi.createCompletion({
      model: "text-davinci-003",
      prompt: `write poem: ${prompt}`,
      max_tokens: 512,
    });

    console.log("newPoem: ", newPoem);

    const newOpen = new OpenAi({
      user: use._id,
      type: "poem",
      payload: `write poem: ${prompt}`,
      asked: prompt,
      data: newPoem.data,
    });

    await newOpen.save();

    res.status(201).json(newOpen);
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Create poem failed",
    });
  }
};

const createImages = async (req, res) => {
  try {
    const { use } = req.user;
    const { prompt, size } = req.body;
    const newImages = await openAi.createImage({
      prompt,
      n: 1,
      size,
    });
    console.log("newImages: ", newImages);
    const newOpen = new OpenAi({
      user: use._id,
      type: "images",
      payload: prompt,
      asked: prompt,
      data: newImages.data,
    });
    await newOpen.save();
    res.status(201).json(newOpen);
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Create poem failed",
    });
  }
};

const createRecommendation = async (req, res) => {
  try {
    const { prompt } = req.body;
    const { use } = req.user;

    const newPoem = await openAi.createCompletion({
      model: "text-davinci-003",
      prompt: `Recommend me: ${prompt}`,
      max_tokens: 512,
    });

    const newOpen = new OpenAi({
      user: use._id,
      type: "recommendation",
      payload: `Recommend me: ${prompt}`,
      asked: prompt,
      data: newPoem.data,
    });

    await newOpen.save();

    res.status(201).json(newOpen);
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Create recommendation failed",
    });
  }
};

const getResponse = async (req, res) => {
  try {
    const { use } = req.user;
    const results = await OpenAi.find({ user: use._id })
      .populate("user", "-password")
      .sort("-createdAt")
      .limit(20)
      .exec();

    res.status(200).json(results);
  } catch (error) {
    console.log("err: ", error);
    res.status(400).json({
      message: "Get response failed",
    });
  }
};

module.exports = {
  createPoem,
  createImages,
  createRecommendation,
  getResponse,
  createMessage,
  getMessagesOfRoom,
  getRooms,
  getMessage,
  updateTitleOfRoom,
  deleteRoom,
  getGeneralRooms,
  createRoom,
  getMessageDetail,
};
