import "./set-public-path";
import "./styles.css";

import React from "react";
import ReactDOM from "react-dom";
import singleSpaReact from "single-spa-react";

import { RemoteErrorBoundary } from "./RemoteErrorBoundary";
import { TrafficApp } from "./TrafficApp";

function Root() {
  return (
    <RemoteErrorBoundary>
      <TrafficApp />
    </RemoteErrorBoundary>
  );
}

const lifecycles = singleSpaReact({
  React,
  ReactDOM,
  rootComponent: Root,
  errorBoundary(error) {
    return (
      <section className="traffic-crash" role="alert">
        <strong>Traffic MFE failed to start</strong>
        <p>{error.message}</p>
      </section>
    );
  },
});

export const { bootstrap, mount, unmount } = lifecycles;
