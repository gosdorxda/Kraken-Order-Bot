import { Router, type IRouter } from "express";
import botsRouter from "./bots";
import accountRouter from "./account";
import infoRouter from "./info";
import systemRouter from "./system";
import settingsRouter from "./settings";
import telegramRouter from "./telegram";

const router: IRouter = Router();

router.use(botsRouter);
router.use(accountRouter);
router.use(infoRouter);
router.use(systemRouter);
router.use(settingsRouter);
router.use(telegramRouter);

export default router;
