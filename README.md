# Air Quality Agent

The Air quality agent does the following:

* Present a chat interface using which the user can interact with the system like chatting with a person.
* The user can ask questions related to air quality and pollution data which can be fetched by the system from publicly available APIs provided by OpenAQ.
* The system can ingest documents which contains information pertaining to air quality and pollutants.
* When asked questions, the system can fetch data from the API and from the data which it would have ingested earlier and use both to generate meaningful replies.

## Prerequisites

1. Docker
2. Nodejs

## Installation

The following instructions are meant for Unix/Linux but may be modified to work on Windows as well.

### 1. Docker

Install docker. Once docker is installed install chromadb using the following command:

```
docker run -d -v ./chroma-data:/data -p 8000:8000 chromadb/chroma
```

Check if chromadb is installed and running by doing:

```
docker ps
```

### 2. Node.js

Install nodejs - https://nodejs.org/en/download
Follow the installation instructions for your platform.

### Building and running the application locally

There are two directories besides this README file - backend and frontend. They need to be run separately.

### Running the backend

Inside the backend make a copy of the .env.local file and name it .env
Inside the .env file put your OPENAI_API_KEY and OPENAQ_API_KEY
Run the following commands in a terminal inside the backend directory to download the dependencies:

```
npm install
```

Chroma DB needs to be populated next by ingesting the data in the docs directory. For demo purposes this directory has markdown files. In a real life scenario, this could contain files in several different formats and the capability to ingest them would be built into the application. To ingest the documents, run this command:

```
npm run ingest
```

To build and run the application execute this command:

```
npm run build
npm run dev
```

### Running the frontend

Inside the frontend directory inside a terminal run the following command to install the dependencies.

```
npm install
```

To build and start the application run the following command:

```
npm run dev
```

The application would start on port 5173. If port 5173 is already used by some other process it will try to take up the next port and so on till it finds a free port. Its assumed that the application starts on port 5173(Which it would display after starting successfully on the terminal).

Open up the browser and go to the URL:

```
http://localhost:5173
```

### Asking questions

You may ask a question like - **What's the air quality like in Masachusettes?** or **What's the ozone level in New York City?** and the system would fetch data from openaq using the geolocation of the city you specify and then fetch related documents from chroma DB and the respond with both. At the end of the response it would also show the source documents as well as the function call parameters.

### Architecture Diagram:

```mermaid
flowchart LR
  %% Actors
  user[User] --> browser[Web Browser]

  %% Cloud
  subgraph AWS
    direction TB

    %% Frontend
    s3[(S3 Bucket<br/>Static Website)]
    browser --> s3

    %% Backend on EC2
    subgraph EC2
      direction TB
      app[Express App<br/>Air Quality Agent]
      subgraph Docker
        direction TB
        chroma[(ChromaDB Container)]
      end
      app --- chroma
    end

    %% SPA -> API
    s3 --> app
  end

  %% Styling
  classDef actor fill:#ffffff,stroke:#666,rx:6,ry:6,color:#111;
  classDef service fill:#f6f8fa,stroke:#666,rx:6,ry:6,color:#111;
  classDef datastore fill:#fffbe6,stroke:#c9a227,rx:6,ry:6,color:#111;

  class user,browser actor;
  class app service;
  class s3,chroma datastore;
```

### Architecture / component diagram (containers and data flow)

```mermaid
flowchart LR
  user[User] --> browser[Web Browser]

  subgraph AWS
    direction TB

    s3[S3 Static Site]
    browser --> s3

    subgraph EC2
      direction TB
      api[Express Backend]
      subgraph Docker
        chroma[ChromaDB]
      end
      api --- chroma
    end
  end

  s3 --> api

  %% External services
  openai[OpenAI API]
  openaq[OpenAQ API]

  api --> openai
  api --> openaq
```

### Runtime sequence diagram for a single /chat request

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant F as Frontend SPA
  participant B as Express Backend
  participant A as answerUser in agent ts
  participant C as Chroma module
  participant Ux as utils module
  participant O as OpenAI API
  participant Q as OpenAQ API

  U->>F: Type message
  F->>B: POST /chat with user message
  B->>A: call answerUser

  A->>Ux: buildContext with message
  A->>C: getOrCreateCollection
  C-->>A: collection handle
  A->>C: ragQuery with embeddings
  C-->>A: retrieved passages
  A->>Ux: merge context and passages

  A->>O: chat completion with user message and context
  alt tool call required
    O-->>A: tool call request
    A->>Q: fetch data from OpenAQ via tool function
    Q-->>A: air quality data
    A->>O: send tool result
    O-->>A: final completion text
  else no tool call
    O-->>A: final completion text
  end

  A-->>B: answer payload
  B-->>F: JSON response
  F-->>U: render assistant reply
```
