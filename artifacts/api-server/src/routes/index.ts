import { Router, type IRouter } from "express";
import botsRouter from "./bots";
import accountRouter from "./account";
import infoRouter from "./info";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(botsRouter);
router.use(accountRouter);
router.use(infoRouter);
router.use(settingsRouter);

export default router;
