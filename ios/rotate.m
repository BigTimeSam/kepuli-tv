// Turns a simulated device, as Simulator's Device > Rotate does.
//
//   ios/dist/rotate <udid> portrait|landscape      (ios/sim.mjs compiles and runs it)
//
// simctl has no verb for it, and the app cannot do it for itself: on an
// iPad that takes part in multitasking, UIKit refuses a programmatic turn
// ("The current windowing mode does not allow for programmatic changes to
// interface orientation", measured on iPadOS 26.5), and the old trick of
// setting UIDevice's orientation does nothing. The Simulator app needs a
// window and the focus, which a test run has no business taking.
//
// So this sends what Simulator sends: a GraphicsServices event of type 50
// (the device's orientation changed) to the device's PurpleWorkspacePort,
// found through CoreSimulator. Both are private; the layout was read from
// Simulator's own -[SimDevice(GSEventsPrivate) sendPurpleEvent:] in Xcode
// 26.6 (the event record in its 32-bit packing, the size at 0x48, the
// payload at 0x4c, the host flag 0x20000 on the type; without the flag the
// event is ignored, measured) and works on the iOS 26.5 runtime.
// If a later Xcode changes it, the turn silently does not happen and
// sim.mjs says so. A development tool only: nothing of it is in the app.

#import <Foundation/Foundation.h>
#import <mach/mach.h>
#import <mach/mach_time.h>
#import <objc/message.h>

#pragma pack(push, 4)
typedef struct {
    mach_msg_header_t header;
    uint32_t type;
    uint32_t subtype;
    float location[2];
    float windowLocation[2];
    uint32_t windowContextId;
    uint64_t timestamp;
    uint32_t window;
    uint32_t flags;
    uint32_t senderPID;
    uint32_t infoSize;
    uint32_t orientation;   // a UIDeviceOrientation
    uint8_t padding[28];    // Simulator sends (infoSize + 0x6b) & ~3 bytes: 108
} OrientationMessage;
#pragma pack(pop)

static int fail(NSString *what, NSError *error) {
    fprintf(stderr, "%s%s%s\n", what.UTF8String, error ? ": " : "", error ? error.localizedDescription.UTF8String : "");
    return 1;
}

int main(int argc, char **argv) {
    @autoreleasepool {
        NSString *wanted = argc == 3 ? @(argv[2]) : @"";
        // Landscape is the device turned to the left, UIDeviceOrientation 3;
        // portrait is 1.
        uint32_t orientation = [wanted isEqual:@"landscape"] ? 3 : [wanted isEqual:@"portrait"] ? 1 : 0;
        if (!orientation) return fail(@"usage: rotate <udid> portrait|landscape", nil);

        if (![[NSBundle bundleWithPath:@"/Library/Developer/PrivateFrameworks/CoreSimulator.framework"] load]) return fail(@"CoreSimulator.framework did not load", nil);
        NSString *developer = @(getenv("DEVELOPER_DIR") ?: "/Applications/Xcode.app/Contents/Developer");
        NSError *error = nil;
        id context = ((id (*)(id, SEL, id, NSError **))objc_msgSend)(NSClassFromString(@"SimServiceContext"),
            NSSelectorFromString(@"sharedServiceContextForDeveloperDir:error:"), developer, &error);
        id set = context ? ((id (*)(id, SEL, NSError **))objc_msgSend)(context, NSSelectorFromString(@"defaultDeviceSetWithError:"), &error) : nil;
        if (!set) return fail(@"no simulator device set", error);
        NSDictionary *devices = ((id (*)(id, SEL))objc_msgSend)(set, NSSelectorFromString(@"devicesByUDID"));
        NSUUID *udid = [[NSUUID alloc] initWithUUIDString:@(argv[1])];
        id device = udid ? devices[udid] : nil;
        if (!device) return fail(@"no such simulator", nil);
        mach_port_t port = ((mach_port_t (*)(id, SEL, id, NSError **))objc_msgSend)(device, NSSelectorFromString(@"lookup:error:"), @"PurpleWorkspacePort", &error);
        if (!MACH_PORT_VALID(port)) return fail(@"the simulator has no PurpleWorkspacePort (is it booted?)", error);

        OrientationMessage message = { 0 };
        message.header.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0);
        message.header.msgh_size = sizeof(message);
        message.header.msgh_remote_port = port;
        message.header.msgh_id = 0x7B;
        message.type = 50 | 0x20000;
        message.timestamp = mach_absolute_time();
        message.infoSize = sizeof(message.orientation);
        message.orientation = orientation;
        kern_return_t result = mach_msg_send(&message.header);
        if (result != KERN_SUCCESS) return fail(@(mach_error_string(result)), nil);
    }
    return 0;
}
