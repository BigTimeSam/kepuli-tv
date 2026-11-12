---
title: Stalker portal player in the browser, with your MAC address | Kepuli-TV
description: Watch a Stalker (MAG) portal in Chrome or Firefox without a set-top box. Kepuli-TV takes the portal address and the MAC address registered to your subscription.
shot: 01-channels
alt: Live channels in Kepuli-TV, one of them playing beside the list
stores: chrome,firefox
order: 7
---

# Stalker portal player in the browser

A provider that sells its service for MAG set-top boxes gives a portal
address, often ending in `/c/`, and registers a MAC address for the box.
There is no user name or password. Kepuli-TV talks to such a portal from a
browser tab, so the subscription can be watched without the box.

## Connect to a portal

1. Install Kepuli-TV and click its toolbar icon.
2. Paste the portal's address into **Subscription or playlist address**. An
   address ending in `/c/` is recognised, and the form moves to **Stalker
   portal (MAC address)**.
3. Enter the MAC address registered to your subscription.
4. Press **Connect** and choose **Allow** when the browser asks whether
   Kepuli-TV may reach the portal.

> [!IMPORTANT]
> Use only the MAC address registered to your own subscription. Another
> person's, or one from a shared list, may not be used: see the
> [terms of use](/terms/).

## What works

- **Channels, films and series** as the portal lists them.
- **The portal's own programme data** in the list and in
  [the programme guide](/iptv-epg-guide/).
- **Reconnection**: a portal's stream link is often good for one connection
  only, so the player asks for a new one whenever a live stream is opened
  again.

## What does not, yet

- **The portal's archive** (catch-up) is not there yet.
- **Sync** leaves a Stalker account out unless **Include passwords** is
  on, as the MAC address is as good as a password.

## How it reaches the portal

A portal expects a MAG box: the MAC address in a cookie and a set-top box's
name as the browser's. A web page cannot set those itself, so the extension
sets them for its own requests to the portal's server alone, and the rule is
gone when the browser closes. The details are in the
[user guide](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals).
