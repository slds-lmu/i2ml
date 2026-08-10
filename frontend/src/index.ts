import "./runtime-compat";
import "./lecture.css";
import { LectureApp } from "./lecture-app";

if (!customElements.get("i2ml-lecture-app")) {
  customElements.define("i2ml-lecture-app", LectureApp);
}

