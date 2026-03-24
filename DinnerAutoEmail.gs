/**
 * Auto-Email on "A Dinner" Subject + Reply Monitoring
 *
 * Setup:
 * 1. Go to script.google.com and create a new project
 * 2. Paste this entire script
 * 3. Fill in RECIPIENT_EMAIL below
 * 4. Run setup() once (grants permissions + creates triggers)
 * 5. Done — checks every 5 minutes automatically
 *
 * Behavior:
 * - Forwards "A Dinner" emails to David asking "what's the food?"
 * - Monitors David's reply: if it contains "pizza", does nothing;
 *   otherwise creates a Google Calendar event from the original email
 *
 * To change check frequency, edit INTERVAL_MINUTES below.
 * To stop, go to Triggers (clock icon) and delete the triggers.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const RECIPIENT_EMAIL        = "FILL_IN_RECIPIENT@example.com"; // ← Change this
const SUBJECT_SEARCH         = "A Dinner";
const LABEL_NAME             = "processed-dinner";
const REPLY_LABEL_NAME       = "reply-processed";
const REPLY_SUBJECT_MARKER   = "What's the food?";
const INTERVAL_MINUTES       = 5;
const DEFAULT_EVENT_HOUR     = 18;
const DEFAULT_EVENT_DURATION_HOURS = 2;

// ─── Main: Forward Dinner Emails ─────────────────────────────────────────────

function checkForDinnerEmails() {
  var label = getOrCreateLabel(LABEL_NAME);
  var query = 'subject:"' + SUBJECT_SEARCH + '" is:unread -label:' + LABEL_NAME;
  var threads = GmailApp.search(query);

  if (threads.length === 0) return;

  threads.forEach(function(thread) {
    var message = thread.getMessages()[0];
    var subject = message.getSubject();
    var sender  = message.getFrom();
    var date    = message.getDate();
    var body    = message.getPlainBody();

    var outSubject = "Re: " + subject + " — What's the food?";
    var outBody =
      "Hey David,\n\n" +
      "I saw there's a dinner coming up — what's the food going to be?\n\n" +
      "--- Original email ---\n" +
      "From: " + sender + "\n" +
      "Date: " + date + "\n" +
      "Subject: " + subject + "\n\n" +
      body;

    GmailApp.sendEmail(RECIPIENT_EMAIL, outSubject, outBody);
    thread.addLabel(label);
  });
}

// ─── Reply Checker ───────────────────────────────────────────────────────────

function checkForDavidReplies() {
  var label = getOrCreateLabel(REPLY_LABEL_NAME);
  var query = 'from:' + RECIPIENT_EMAIL +
    ' subject:"' + REPLY_SUBJECT_MARKER + '" -label:' + REPLY_LABEL_NAME;
  var threads = GmailApp.search(query);

  if (threads.length === 0) return;

  threads.forEach(function(thread) {
    var messages = thread.getMessages();
    var reply = messages[messages.length - 1];
    var replyBody = reply.getPlainBody().toLowerCase();

    if (replyBody.includes("pizza")) {
      Logger.log("Pizza detected — skipping calendar event");
      thread.addLabel(label);
      return;
    }

    // Parse event from the first message (our forwarded email)
    var forwardedBody = messages[0].getPlainBody();
    var details = parseEventDetails(forwardedBody);

    if (!details.date) {
      Logger.log("WARNING: Could not parse date from email — will retry next cycle");
      return;
    }

    createDinnerEvent(details);
    thread.addLabel(label);
    Logger.log("Calendar event created: " + details.title);
  });
}

// ─── Event Parsing ───────────────────────────────────────────────────────────

function parseEventDetails(body) {
  var details = {
    title: "",
    start: null,
    end: null,
    date: null,
    location: "",
    description: ""
  };

  // Description: everything after "--- Original email ---"
  var origIdx = body.indexOf("--- Original email ---");
  if (origIdx !== -1) {
    details.description = body.substring(origIdx);
  }

  // Title from Subject: line in forwarded block
  var subjectMatch = body.match(/Subject:\s*(.+)/);
  if (subjectMatch) {
    details.title = subjectMatch[1].replace(/\s*[—–-]\s*What's the food\?/, "").trim();
  }
  if (!details.title) {
    details.title = "Dinner Event";
  }

  // Date + time: "March 31, 5:30-7 p.m." or "March 31, 5:30 - 7:00 p.m."
  var dateTimeMatch = body.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{1,2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}(?::\d{2})?)\s*(a\.?m\.?|p\.?m\.?)/i
  );

  if (dateTimeMatch) {
    var monthStr = dateTimeMatch[1];
    var day = parseInt(dateTimeMatch[2], 10);
    var startTimeStr = dateTimeMatch[3];
    var endTimeStr = dateTimeMatch[4];
    var ampm = dateTimeMatch[5].replace(/\./g, "").toLowerCase();

    var year = getYearFromBody(body);
    var monthIndex = monthToIndex(monthStr);

    var startHour = parseTimeToHour(startTimeStr, ampm);
    var startMin = parseTimeToMinutes(startTimeStr);
    var endHour = parseTimeToHour(endTimeStr, ampm);
    var endMin = parseTimeToMinutes(endTimeStr);

    details.date = new Date(year, monthIndex, day);
    details.start = new Date(year, monthIndex, day, startHour, startMin);
    details.end = new Date(year, monthIndex, day, endHour, endMin);
  } else {
    // Fallback: date-only match "March 31"
    var dateOnlyMatch = body.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i
    );
    if (dateOnlyMatch) {
      var monthStr2 = dateOnlyMatch[1];
      var day2 = parseInt(dateOnlyMatch[2], 10);
      var year2 = getYearFromBody(body);
      var monthIndex2 = monthToIndex(monthStr2);

      details.date = new Date(year2, monthIndex2, day2);
      details.start = new Date(year2, monthIndex2, day2, DEFAULT_EVENT_HOUR, 0);
      details.end = new Date(year2, monthIndex2, day2,
        DEFAULT_EVENT_HOUR + DEFAULT_EVENT_DURATION_HOURS, 0);
    }
  }

  // Location: line containing building/room keywords
  var locationMatch = body.match(
    /^.*(?:Room|Building|Hall|Complex|Center|Centre|Library|Auditorium|Suite)\b.*$/im
  );
  if (locationMatch) {
    details.location = locationMatch[0].trim();
  }

  return details;
}

function parseTimeToHour(timeStr, ampm) {
  var hour = parseInt(timeStr.split(":")[0], 10);
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return hour;
}

function parseTimeToMinutes(timeStr) {
  var parts = timeStr.split(":");
  return parts.length > 1 ? parseInt(parts[1], 10) : 0;
}

function monthToIndex(monthStr) {
  var months = [
    "january","february","march","april","may","june",
    "july","august","september","october","november","december"
  ];
  return months.indexOf(monthStr.toLowerCase());
}

function getYearFromBody(body) {
  var yearMatch = body.match(/Date:\s*.*?(\d{4})/);
  return yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
}

// ─── Calendar ────────────────────────────────────────────────────────────────

function createDinnerEvent(details) {
  var options = {};
  if (details.location) options.location = details.location;
  if (details.description) options.description = details.description;

  CalendarApp.getDefaultCalendar().createEvent(
    details.title,
    details.start,
    details.end,
    options
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getOrCreateLabel(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
  }
  return label;
}

// ─── Setup (run once) ────────────────────────────────────────────────────────

function setup() {
  // Remove existing triggers for both functions
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var fn = trigger.getHandlerFunction();
    if (fn === "checkForDinnerEmails" || fn === "checkForDavidReplies") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create time-driven triggers
  ScriptApp.newTrigger("checkForDinnerEmails")
    .timeBased()
    .everyMinutes(INTERVAL_MINUTES)
    .create();

  ScriptApp.newTrigger("checkForDavidReplies")
    .timeBased()
    .everyMinutes(INTERVAL_MINUTES)
    .create();

  Logger.log("Triggers created: checkForDinnerEmails + checkForDavidReplies every " +
    INTERVAL_MINUTES + " minutes");

  // Run once immediately to test
  checkForDinnerEmails();
  checkForDavidReplies();
  Logger.log("Initial run complete. Check your sent mail and calendar.");
}
