package io.github.bigtimesam.kepulitv;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;

import java.util.Locale;
import java.util.Map;

/**
 * The controls of the app's own player, the ones the app for the iPhone
 * and the iPad draws (ios/App/Player/NativePlayerView.swift), so that the
 * player is one to the viewer on every device: what plays and where the
 * picture goes in a bar at the top, the transport in the middle, the time
 * line or the mark of a live channel with full screen at the foot, each
 * group in a dark capsule. They show at a touch and go four seconds
 * later; a paused picture keeps them until it is touched again.
 *
 * The same controls lie over what the page plays in its own picture, and
 * over the second of two pictures side by side. They only draw and say
 * what was pressed (Presses); what a press does is NativePlayer's.
 */
final class PlayerControls extends FrameLayout {
    /** What was pressed: toggle, seek (with the second to go to), full, sound, swap, close, cast, pip, tracks. */
    interface Presses {
        void press(String what, double to);
    }

    private static final long SHOWN_MS = 4000;
    private static final int WHITE = Color.WHITE;

    private final Presses presses;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final float dp;

    private final FrameLayout bars;
    private final ProgressBar wheel;
    private final LinearLayout titles;
    private final TextView title;
    private final TextView subtitle;
    private final LinearLayout targets;
    private final LinearLayout centre;
    private final ImageButton play;
    private final View back;
    private final View forward;
    private final TextView liveBadge;
    private final View liveSpace;
    private final TextView elapsed;
    private final TextView remaining;
    private final SeekBar line;
    private final ImageButton full;
    private final ImageButton sound;
    private final ImageButton tracks;
    private final ImageButton small;
    private final ImageButton cast;
    private final ImageButton swap;
    private final ImageButton close;

    private Map<String, String> labels = new java.util.HashMap<>();
    private boolean live;
    private boolean paused;
    private boolean scrubbing;
    private boolean waiting;
    /** Nothing but the wheel: a television's remote drives the page, which draws its own. */
    private boolean bare;
    /** The small window shows the picture alone. */
    private boolean away;
    private boolean second;
    private boolean castOffered;
    private boolean smallOffered;
    private boolean tracksOffered;
    private boolean soundOffered;
    private double now;
    private double length = Double.NaN;

    private final Runnable hide = () -> hide(false);

    PlayerControls(Context context, Presses presses) {
        super(context);
        this.presses = presses;
        dp = context.getResources().getDisplayMetrics().density;

        bars = new FrameLayout(context);
        GradientDrawable shade = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[] { 0x99000000, 0x00000000, 0x00000000, 0xB3000000 });
        bars.setBackground(shade);
        addView(bars, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        wheel = new ProgressBar(context);
        wheel.setIndeterminateTintList(ColorStateList.valueOf(WHITE));
        wheel.setVisibility(GONE);
        addView(wheel, new LayoutParams(px(48), px(48), Gravity.CENTER));

        // Top left: what plays. Top right: where the picture goes.
        title = text(19, true);
        subtitle = text(14, false);
        subtitle.setTextColor(0xBFFFFFFF);
        titles = new LinearLayout(context);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.addView(title);
        titles.addView(subtitle);
        sound = button(R.drawable.player_quiet, 40, "sound");
        tracks = button(R.drawable.player_tracks, 40, "tracks");
        small = button(R.drawable.player_small, 40, "pip");
        cast = button(R.drawable.player_cast, 40, "cast");
        swap = button(R.drawable.player_swap, 40, "swap");
        close = button(R.drawable.player_close, 40, "close");
        targets = capsule(6, sound, tracks, small, cast, swap, close);
        LinearLayout top = new LinearLayout(context);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.addView(titles, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        top.addView(targets, new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
        LayoutParams atTop = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.TOP);
        atTop.setMargins(px(16), px(12), px(16), 0);
        bars.addView(top, atTop);

        // Centre: the transport.
        back = skip(R.drawable.player_back, -10);
        play = button(R.drawable.player_pause, 64, "toggle");
        forward = skip(R.drawable.player_forward, 10);
        centre = capsule(12, back, play, forward);
        bars.addView(centre, new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        // Bottom: the time line, or that the channel is live, and full screen.
        liveBadge = text(12, true);
        GradientDrawable red = new GradientDrawable();
        red.setColor(0xFFE5484D);
        red.setCornerRadius(6 * dp);
        liveBadge.setBackground(red);
        liveBadge.setPadding(px(8), px(3), px(8), px(3));
        // A view with no height of its own takes all it is offered: the
        // capsule stood as tall as the picture around it.
        liveSpace = new View(context);
        liveSpace.setLayoutParams(new LinearLayout.LayoutParams(0, 1, 1));
        elapsed = text(13, false);
        remaining = text(13, false);
        for (TextView clock : new TextView[] { elapsed, remaining }) clock.setTypeface(Typeface.MONOSPACE);
        line = new SeekBar(context);
        line.setMax(1000);
        line.setProgressTintList(ColorStateList.valueOf(WHITE));
        line.setThumbTintList(ColorStateList.valueOf(WHITE));
        line.setProgressBackgroundTintList(ColorStateList.valueOf(0x4DFFFFFF));
        line.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (fromUser && length > 0) clocks(progress / 1000.0 * length);
            }

            @Override
            public void onStartTrackingTouch(SeekBar bar) {
                scrubbing = true;
                main.removeCallbacks(hide);
            }

            @Override
            public void onStopTrackingTouch(SeekBar bar) {
                scrubbing = false;
                if (length > 0) seek(bar.getProgress() / 1000.0 * length);
                show();
            }
        });
        full = button(R.drawable.player_full, 40, "full");
        LinearLayout foot = capsule(8, liveBadge, liveSpace, elapsed, line, remaining, full);
        ((LinearLayout.LayoutParams) line.getLayoutParams()).width = 0;
        ((LinearLayout.LayoutParams) line.getLayoutParams()).weight = 1;
        ((LinearLayout.LayoutParams) liveBadge.getLayoutParams()).leftMargin = px(6);
        ((LinearLayout.LayoutParams) elapsed.getLayoutParams()).leftMargin = px(8);
        LayoutParams atFoot = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        atFoot.setMargins(px(16), 0, px(16), px(12));
        bars.addView(foot, atFoot);

        // As on the page's own picture: a tap shows or hides the controls
        // and a double tap is full screen and back.
        GestureDetector taps = new GestureDetector(context, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(MotionEvent event) {
                return true;
            }

            @Override
            public boolean onSingleTapConfirmed(MotionEvent event) {
                if (shown()) hide(true); else show();
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent event) {
                presses.press("full", 0);
                return true;
            }
        });
        setOnTouchListener((view, event) -> !bare && !away && taps.onTouchEvent(event));
        setLive(false);
        setFull(false);
        offer();
    }

    private int px(float units) {
        return Math.round(units * dp);
    }

    private TextView text(int size, boolean bold) {
        TextView view = new TextView(getContext());
        view.setTextColor(WHITE);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, size);
        view.setSingleLine(true);
        view.setEllipsize(TextUtils.TruncateAt.END);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private ImageButton button(int mark, int side, String what) {
        ImageButton button = new ImageButton(getContext());
        button.setImageResource(mark);
        button.setScaleType(ImageView.ScaleType.FIT_CENTER);
        int room = px(side * 0.2f);
        button.setPadding(room, room, room, room);
        TypedValue ripple = new TypedValue();
        getContext().getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, ripple, true);
        button.setBackgroundResource(ripple.resourceId);
        button.setLayoutParams(new LinearLayout.LayoutParams(px(side), px(side)));
        button.setOnClickListener((view) -> {
            presses.press(what, 0);
            // The close takes the picture away, controls and all.
            if (!what.equals("close")) show();
        });
        return button;
    }

    /** Ten seconds back or on: the turning arrow with its number in it. */
    private View skip(int mark, int by) {
        FrameLayout box = new FrameLayout(getContext());
        ImageButton button = button(mark, 48, "");
        button.setOnClickListener((view) -> {
            seek(Math.max(0, Math.min(now + by, length > 0 ? length : Double.MAX_VALUE)));
            show();
        });
        box.addView(button, new LayoutParams(px(48), px(48)));
        TextView number = text(9, true);
        number.setText("10");
        LayoutParams at = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        at.topMargin = px(2);
        box.addView(number, at);
        box.setLayoutParams(new LinearLayout.LayoutParams(px(48), px(48)));
        return box;
    }

    /** A dark capsule around a row of controls, as the iPhone's app groups them in glass. */
    private LinearLayout capsule(int spacing, View... views) {
        LinearLayout row = new LinearLayout(getContext());
        row.setGravity(Gravity.CENTER_VERTICAL);
        GradientDrawable ground = new GradientDrawable();
        ground.setColor(0xB3101218);
        ground.setCornerRadius(999 * dp);
        ground.setStroke(Math.max(1, px(1)), 0x33FFFFFF);
        row.setBackground(ground);
        row.setPadding(px(8), px(4), px(8), px(4));
        // A press between two buttons is not a tap on the picture.
        row.setClickable(true);
        for (View view : views) {
            LinearLayout.LayoutParams at = view.getLayoutParams() instanceof LinearLayout.LayoutParams
                    ? (LinearLayout.LayoutParams) view.getLayoutParams()
                    : new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
            if (row.getChildCount() > 0) at.leftMargin = px(spacing);
            row.addView(view, at);
        }
        return row;
    }

    /* ---------------------------------------------------------- what plays */

    /** The page's words for what plays and for the controls, in the viewer's language. */
    void show(String name, String under, boolean live, Map<String, String> labels) {
        this.labels = labels;
        title.setText(name);
        subtitle.setText(under);
        subtitle.setVisibility(under.isEmpty() ? GONE : VISIBLE);
        String word = labels.get("live");
        liveBadge.setText(word == null || word.isEmpty() ? "●" : "● " + word.toUpperCase(Locale.ROOT));
        cast.setContentDescription(labels.get("cast"));
        tracks.setContentDescription(labels.get("subtitles"));
        now = 0;
        length = Double.NaN;
        paused = false;
        line.setProgress(0);
        elapsed.setText(clock(0));
        remaining.setText("");
        setLive(live);
        draw();
        show();
    }

    /** A time line, or the mark of a live channel in its place. */
    void setLive(boolean live) {
        this.live = live;
        for (View view : new View[] { elapsed, line, remaining, back, forward }) view.setVisibility(live ? GONE : VISIBLE);
        liveBadge.setVisibility(live ? VISIBLE : GONE);
        liveSpace.setVisibility(live ? VISIBLE : GONE);
    }

    boolean live() {
        return live;
    }

    /** Where the picture is; a length that is not a number is none. */
    void place(boolean paused, double position, double duration) {
        boolean was = this.paused;
        this.paused = paused;
        now = position;
        length = duration;
        draw();
        // Paused from elsewhere (the page's key, a headset): the controls say so.
        if (paused != was) show();
    }

    private void draw() {
        play.setImageResource(paused ? R.drawable.player_play : R.drawable.player_pause);
        play.setContentDescription(labels.get(paused ? "play" : "pause"));
        if (live || scrubbing || !(length > 0)) return;
        line.setProgress((int) Math.round(now / length * 1000));
        clocks(now);
    }

    private void clocks(double at) {
        elapsed.setText(clock(at));
        remaining.setText("-" + clock(length - at));
    }

    static String clock(double seconds) {
        if (Double.isNaN(seconds) || Double.isInfinite(seconds)) return "0:00";
        long s = (long) Math.max(0, seconds);
        return s >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
                : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
    }

    private void seek(double to) {
        now = to;
        draw();
        presses.press("seek", to);
    }

    /** The page says what plays above its picture; over the whole screen nothing else does. */
    void setFull(boolean on) {
        full.setImageResource(on ? R.drawable.player_leave : R.drawable.player_full);
        full.setContentDescription(labels.get(on ? "leave" : "full"));
        titles.setVisibility(on || second ? VISIBLE : INVISIBLE);
        // Over the whole glass the bars keep clear of the camera's cutout,
        // which the activity's frame keeps the page clear of otherwise.
        android.view.WindowInsets insets = getRootWindowInsets();
        android.view.DisplayCutout cutout = on && insets != null && android.os.Build.VERSION.SDK_INT >= 28 ? insets.getDisplayCutout() : null;
        if (cutout == null) bars.setPadding(0, 0, 0, 0);
        else bars.setPadding(cutout.getSafeInsetLeft(), cutout.getSafeInsetTop(), cutout.getSafeInsetRight(), cutout.getSafeInsetBottom());
    }

    /**
     * The second of two pictures: a swap and a close of its own, and none
     * of what is the first picture's (the small window, the Cast mark, the
     * tracks). Its name shows over it always, as nothing else says which
     * channel the half is.
     */
    void setSecond(boolean on) {
        second = on;
        titles.setVisibility(on ? VISIBLE : titles.getVisibility());
        offer();
    }

    /** Whether this picture is the one heard, and whether it shows its speaker at all (only beside another). */
    void setSound(boolean on, boolean offered) {
        soundOffered = offered;
        sound.setImageResource(on ? R.drawable.player_sound : R.drawable.player_quiet);
        offer();
    }

    /** What the app around the player can do, and whether the stream has tracks to choose from. */
    void offers(boolean cast, boolean small) {
        castOffered = cast;
        smallOffered = small;
        offer();
    }

    void setTracks(boolean any) {
        tracksOffered = any;
        offer();
    }

    View tracksButton() {
        return tracks;
    }

    /** The Cast mark in the accent's colour while a session is on. */
    void setCasting(boolean on) {
        cast.setImageTintList(ColorStateList.valueOf(on ? 0xFF8B7CFF : WHITE));
    }

    private void offer() {
        sound.setVisibility(soundOffered ? VISIBLE : GONE);
        tracks.setVisibility(tracksOffered && !second ? VISIBLE : GONE);
        small.setVisibility(smallOffered && !second ? VISIBLE : GONE);
        cast.setVisibility(castOffered && !second ? VISIBLE : GONE);
        swap.setVisibility(second ? VISIBLE : GONE);
        close.setVisibility(second ? VISIBLE : GONE);
        // A bar with nothing in it is not drawn.
        boolean any = false;
        for (int i = 0; i < targets.getChildCount(); i++) any |= targets.getChildAt(i).getVisibility() == VISIBLE;
        targets.setVisibility(any ? VISIBLE : INVISIBLE);
    }

    /**
     * The wheel over the picture while nothing moves yet. It stands where
     * the transport does, and the two drawn over each other were a muddle
     * of marks: the transport is away while the wheel turns.
     */
    void setWaiting(boolean on) {
        waiting = on;
        wheel.setVisibility(on ? VISIBLE : GONE);
        centre.setVisibility(on ? INVISIBLE : VISIBLE);
    }

    /** Nothing but the wheel (a television, whose remote drives the page's own marks). */
    void setBare(boolean on) {
        bare = on;
        if (on) bars.setVisibility(GONE);
    }

    /** The small window shows the picture alone. */
    void setAway(boolean on) {
        away = on;
        if (on) {
            main.removeCallbacks(hide);
            bars.setVisibility(GONE);
        } else {
            show();
        }
    }

    @Override
    protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        // A phone's upright picture is some 226 units high: the transport
        // at its full size covered half of it.
        float scale = height < 280 * dp ? 0.72f : 1;
        centre.setScaleX(scale);
        centre.setScaleY(scale);
        // Half a phone's width, beside a second picture: the top bar's
        // buttons were wider than the picture. Smaller, from its own corner.
        float less = width < 240 * dp ? 0.74f : 1;
        targets.post(() -> {
            targets.setPivotX(targets.getWidth());
            targets.setPivotY(0);
            targets.setScaleX(less);
            targets.setScaleY(less);
        });
    }

    /* --------------------------------------------------- showing and hiding */

    boolean shown() {
        return bars.getVisibility() == VISIBLE && bars.getAlpha() > 0.5f;
    }

    void show() {
        main.removeCallbacks(hide);
        if (bare || away) return;
        bars.animate().cancel();
        bars.setVisibility(VISIBLE);
        bars.animate().alpha(1).setDuration(200).start();
        main.postDelayed(hide, SHOWN_MS);
    }

    /**
     * A paused picture keeps its controls when their time is up; a tap on
     * the picture still puts them away, to look at the still picture
     * without them.
     */
    private void hide(boolean asked) {
        main.removeCallbacks(hide);
        if (!asked && (paused || scrubbing)) return;
        bars.animate().alpha(0).setDuration(300).withEndAction(() -> bars.setVisibility(INVISIBLE)).start();
    }

    @Override
    protected void onDetachedFromWindow() {
        main.removeCallbacks(hide);
        super.onDetachedFromWindow();
    }
}
