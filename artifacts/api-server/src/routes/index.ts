import { Router, type IRouter } from "express";
import botsRouter from "./bots";
import accountRouter from "./account";
import infoRouter from "./info";

const router: IRouter = Router();

router.use(botsRouter);
router.use(accountRouter);
router.use(infoRouter);

export default router;
