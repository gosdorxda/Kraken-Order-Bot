import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botsRouter from "./bots";
import accountRouter from "./account";
import infoRouter from "./info";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botsRouter);
router.use(accountRouter);
router.use(infoRouter);

export default router;
