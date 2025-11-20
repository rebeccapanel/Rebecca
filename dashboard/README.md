# Dashboard UI for Rebecca

## Requirements

For development, you will only need Node.js installed on your environement.

### Node

[Node](http://nodejs.org/) is really easy to install & now include [NPM](https://npmjs.org/).
This project has been developed on the Nodejs v16.17.0 so if you faced any issue during installation that may related to the node version, install Node with version >= v16.17.0.

## Install

    git clone https://github.com/rebeccapanel/Rebecca.git
    cd Rebecca/dashboard
    npm install

### Configure app

Copy `example.env` to `.env` then set the backend api address:

    VITE_BASE_API=https://somewhere.com/api/

#### Environment variables

| Name          | Description                                                                          |
| ------------- | ------------------------------------------------------------------------------------ |
| VITE_BASE_API | The api url of the deployed backend ([Rebecca](https://github.com/rebeccapanel/Rebecca)) |

## Start development server

    npm run dev

## Simple build for production

    npm run build

## Contribution

Feel free to contribute. Go on and fork the project. After commiting the changes, make a PR. It means a lot to us.
