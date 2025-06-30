import React from "react";
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Redirect
} from "react-router-dom";
import { Navbar } from "./app/Navbar";

function App() {
    return (
        <Navbar />
    );
}

export default App;