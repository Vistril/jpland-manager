require("dotenv").config();
var child_process = require("child_process");
var EventEmitter = require("events").EventEmitter;
var colors = require("colors");
var Discord = require("discord.js");
process.chdir("/srv/jpland");


var MAX_IDLE_MINUTES = 60;

class MinecraftServer extends EventEmitter {
	constructor (cwd, jar) {
		super();
		this.cwd = cwd;
		this.jar = jar;
		this.idleMinutes = 0;
		//this.thisIdleCheckTime = 0;
		//this.lastIdleCheckTime = 0;
		this.listCommand = "minecraft:list";
	}

	start() {
		this._log("Starting server".green);
		this.process = child_process.spawn("java", ["-Xmx4G", "-jar", this.jar], {cwd: this.cwd});
		this.process.on("error", error => {
			this.process.emit("exit");
			this._log(error.stack.red, true);
		});
		this.process.stdout.on("data", data => {
			data = data.toString().trim().split("\n");
			data.forEach(data => {
				this._log(data);
				this._handleOutput(data);
			});
		});
		this.process.stderr.on("data", data => {
			data = data.toString().trim().split("\n");
			this._log(data, true);
		});
		this.process.once("exit", () => {
			this.process = undefined;
			clearInterval(this.idleCheckInterval);
			this._log("Server has exited".red);
		});
		this.idleMinutes = 0;
		this.idleCheckInterval = setInterval(()=>{
			//this.lastIdleCheckTime = this.thisIdleCheckTime;
			//this.thisIdleCheckTime = Date.now();
			this.process.stdin.write(this.listCommand + "\n");
		}, 60000);
		return this;
	}

	stop() {
		return this.process && this.process.stdin.write("stop\n");
	}

	restart() {
		if (!this.process) return;
		this.process.on("exit", () => this.start());
		return this.stop();
	}

	_log(msg, isError) {
		return console[isError ? "error" : "log"](`[${this.cwd}]`[isError ? "red" : "green"], msg);
	}
	_handleOutput(line) {
		if (this._testIfConsoleLineIndicatesNoPlayersOnline(line)) {
			// no players are online
			// tried to make it ignore arbitrary listings but I can't seem to figure it out and the issue is not a big deal.
			//if (Date.now() - this.lastIdleCheckTime < IDLE_CHECK_INTERVAL) return; // this list must've been called by someone else, ignore it*/
			this._log("Detected no players online; incrementing idleMinutes".yellow);
			this.idleMinutes++;
			if (this.idleMinutes >= MAX_IDLE_MINUTES)  {
				this.idleMinutes = 0;
				this.stop();
				this._log("Shutting down due to inactivity".red);
				this.emit("idle timeout");
			}
		} else if (this._testIfConsoleLineIndicatesPlayersOnline(line)) {
			// players are online
			//if (Date.now() - this.lastIdleCheckTime < IDLE_CHECK_INTERVAL) return; // ditto*/
			this._log("Detected players online; resetting idle minutes".yellow);
			this.idleMinutes = 0;
		}
	}

	_testIfConsoleLineIndicatesPlayersOnline(line) {
		let foqat = line.substr(line.indexOf(" INFO]: ")+8);
		let fojat = foqat.substr(0, foqat.indexOf(": "));
		return (fojat.startsWith("There are ") && fojat.endsWith(" of a max 20 players online"));
	}

	_testIfConsoleLineIndicatesNoPlayersOnline(line) {
		return line.endsWith(" INFO]: There are 0 of a max 20 players online:");
	}
	
}


var servers = {
	creative: new MinecraftServer("creative", "paper.jar"),
	survival: new MinecraftServer("survival", "paper.jar"),
	modded: new MinecraftServer("forge", "forge-1.12.2-14.23.5.2768-universal.jar"),
};

servers.modded._testIfConsoleLineIndicatesPlayersOnline = function(line) {
	var fojat = line.substr(line.indexOf("] [Server thread/INFO] [minecraft/DedicatedServer]: There are "));
	return (fojat.startsWith("] [Server thread/INFO] [minecraft/DedicatedServer]: There are ") && fojat.endsWith(" players online:"));
}
servers.modded._testIfConsoleLineIndicatesNoPlayersOnline = function(line) {
	return line.endsWith("] [Server thread/INFO] [minecraft/DedicatedServer]: There are 0/20 players online:");
}
servers.modded.listCommand = "list";


function commandHandler(input, priviledged) {
	var args = input.split(' ');
	var cmd = args[0];
	var unauthorized = "You are not permitted to perform this command.";

	var serverName = args[1] && args[1].toLowerCase();
	var server = servers[serverName];

	if (cmd == "start") {
		if (!server) return `Unknown server ${serverName}`
		if (server.process) return `${serverName} server is already running.`;
		server.start();
		return `Starting ${serverName} server.`;
	} else if (cmd == "stop") {
		if (!priviledged) return unauthorized;
		if (!server) return `Unknown server ${serverName}`
		if (!server.process) return `${serverName} server is not running.`;
		server.stop();
		return `Stopping ${serverName} server.`;
	} else if (cmd == "input") {
		if (!priviledged) return unauthorized;
		if (!server) return `Unknown server ${serverName}`
		if (!server.process) return `${serverName} is not running.`;
		if (args[2] == "list" || args[2] == "minecraft:list") return "`list` command is prohibited from running in console because it would interfere with idle minute counting.";
		server.process.stdin.write(args.slice(2).join(" ") + '\n');
		return;
	} else if (cmd == "list") {
		return `Servers: ${Object.keys(servers).map(x => `${x} (${servers[x].process ? 'running' : 'stopped'})`).join(', ')}`;
	} else if (cmd == "eval") {
		if (!priviledged) return unauthorized;
		try {
			return String(eval(args.slice(1).join(' ')));
		} catch (error) {
			return String(error);
		}
	} else if (cmd == "help") {
		return "JPLand Manager automatically shuts down Minecraft servers after "+MAX_IDLE_MINUTES+" minutes to save resources, and allows you to start servers again using the `start <server>` command.\n" +
			"Use `list` to see the list of servers and their statuses.\n" +
			(priviledged ? "\nYou are an admin and may also use these commands: `stop <server>`, `input <server> <command>` (input a command into a server's console), `eval <code>` (evaluate javascript in the Node.js process)." : "");
	} else {
		//return `Unknown command \`${cmd}\`; commands are \`start\`, \`stop\`, \`input\`, \`list\`, and \`eval\`.`;
		return `Unknown command \`${cmd}\`, use \`help\` for the list of commands.`;
	}
}

process.openStdin();
process.stdin.on("data", data => {
	data = data.toString().trim();
	var response = commandHandler(data, true);
	if (response) console.log(response.blue);
});


if (process.env.DISCORD_TOKEN) {
	var dClient = new Discord.Client();
	dClient.login(process.env.DISCORD_TOKEN);
	dClient.on("error", error => console.error(colors.red("Discord client error: " + error.message)));
	function setStatus() {
		dClient.user.setActivity("cmdchar is %, use %help for info");
	}
	setInterval(setStatus, 1000*60*30);
	dClient.on("ready", () => {
		console.log("Discord client is ready.".green);
		setStatus();
	});
	dClient.on("message", message => {
		if (message.channel.id != "452025433328975872") return;
		if (message.content.startsWith('%')) {
			let response = commandHandler(message.content.substr('%'.length), message.member && message.member.roles.map(x => x.name).includes("Minecraft admin"));
			if (response) message.channel.send(response);
		}
	});
	for (let serverName in servers) {
		let server = servers[serverName];
		server.on("idle timeout", () => {
			let channel = dClient.channels.get("452025433328975872");
			if (channel) channel.send(`${serverName} server has been shut down due to 1 hour of inactivity. Run \`%start ${serverName}\` when you want to play on it again.`);
		});
	}
}


console.log("JPLand Manager is now running.".green);
